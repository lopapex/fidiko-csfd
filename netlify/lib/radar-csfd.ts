import { getStore } from "@netlify/blobs";
import type { CSFDMovie, CSFDSearchMovie } from "node-csfd-api";
import { csfdClient } from "./csfd-client";
import { comparableTitle, resolveCsfdTitle, titleSimilarity } from "./csfd-match";
import type { RadarItem, RadarMediaType } from "./radar-refresh";
import { getProviderMetadata } from "./radar-providers";

const CACHE_STORE = "radar-csfd-cache";
const CACHE_VERSION = "v16";
const LOOKUP_CONCURRENCY = 6;
// One ČSFD page, including the retry inside csfdClient.
const LOOKUP_TIMEOUT_MS = 12_000;
// A whole match: a few searches and detail pages.
const MATCH_TIMEOUT_MS = 25_000;
const MATCHED_TTL_MS = 7 * 86_400_000;
// Shorter than the nightly refresh, so a title missing today is asked about again tomorrow.
const NOT_FOUND_TTL_MS = 12 * 3_600_000;

export type RadarCsfdMatch = {
  title: string;
  rating: number | null;
  ratingCount: number | null;
  url: string;
  releaseDate: string | null;
  vodPremieres: RadarCsfdVodPremiere[];
};

export type RadarCsfdVodPremiere = {
  date: string;
  provider: string;
};

export type CsfdPrimaryStreamingSeed = {
  csfdId: number;
  mediaType: RadarMediaType;
  titleSuffix?: string;
  fallbackPremiere?: RadarCsfdVodPremiere;
  fallbackTitle?: string;
  fallbackUrl?: string;
  fallbackPosterUrl?: string | null;
};

export type CachedRadarCsfd =
  | { status: "matched"; checkedAt: string; match: RadarCsfdMatch }
  | { status: "not_found"; checkedAt: string; match: null };

export type RadarCsfdLookupResult =
  | { status: "matched"; match: RadarCsfdMatch }
  | { status: "not_found" }
  | { status: "error" };

export async function enrichRadarItemsWithCsfd(items: RadarItem[]) {
  const unique = new Map<string, RadarItem>();
  for (const item of items) {
    unique.set(`${item.mediaType}-${item.tmdbId}`, item);
  }

  const entries = [...unique.entries()];
  const matches = await mapConcurrent(entries, LOOKUP_CONCURRENCY, async ([key, item]) => [
    key,
    shouldReuseRadarCsfdMatch(item) ? item.csfd : await loadMatch(item)
  ] as const);
  const byItem = new Map(matches);

  return items.map((item) => {
    const match = byItem.get(`${item.mediaType}-${item.tmdbId}`) ?? null;
    const releaseDate = item.channel === "streaming"
      ? match?.releaseDate ?? item.releaseDate
      : item.releaseDate;
    return {
      ...item,
      id: `${item.mediaType}-${item.tmdbId}-${item.channel}-${releaseDate}`,
      title: match?.title ?? item.title,
      releaseDate,
      csfd: match
    };
  });
}

export async function fetchCsfdPrimaryStreamingItems(seeds: CsfdPrimaryStreamingSeed[]) {
  const items = await mapConcurrent<CsfdPrimaryStreamingSeed, RadarItem | null>(seeds, 2, async (seed) => {
    const details = await loadSeedDetails(seed.csfdId);
    if ((!details?.url || !details?.title) && (!seed.fallbackTitle || !seed.fallbackUrl || !seed.fallbackPremiere)) return null;
    const ratingDetails = details
      ? await loadSeriesRatingDetails(details, seed.mediaType)
      : {
        url: seed.fallbackUrl!,
        rating: null,
        ratingCount: null,
      };

    const title = details
      ? formatPrimaryStreamingTitle(details.title, details.seasonName, seed.titleSuffix)
      : formatPrimaryStreamingTitle(seed.fallbackTitle!, null, seed.titleSuffix);
    const vodPremieres = selectCzechVodPremieres(details?.premieres ?? [], { channel: "streaming" });
    const effectiveVodPremieres = vodPremieres.length > 0
      ? vodPremieres
      : seed.fallbackPremiere ? [seed.fallbackPremiere] : [];
    const csfdMatch: RadarCsfdMatch = {
      title,
      rating: numberOrNull(ratingDetails.rating),
      ratingCount: numberOrNull(ratingDetails.ratingCount),
      url: ratingDetails.url,
      releaseDate: effectiveVodPremieres[0]?.date ?? null,
      vodPremieres: effectiveVodPremieres,
    };
    if (!csfdMatch.releaseDate || csfdMatch.vodPremieres.length === 0) return null;

    const item: RadarItem = {
      id: `${seed.mediaType}-csfd-${seed.csfdId}-streaming-${csfdMatch.releaseDate}`,
      tmdbId: -seed.csfdId,
      mediaType: seed.mediaType,
      channel: "streaming",
      title,
      originalTitle: null,
      overview: details?.descriptions?.[0] ?? "",
      posterUrl: optimizeCsfdPoster(details?.poster ?? seed.fallbackPosterUrl ?? null),
      releaseDate: csfdMatch.releaseDate,
      providers: [],
      watchUrl: null,
      csfd: csfdMatch,
      program: null,
    };
    return item;
  });

  return items.filter((item): item is RadarItem => item !== null);
}

async function loadSeedDetails(csfdId: number) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const details = await withTimeout(csfdClient.movie(csfdId), LOOKUP_TIMEOUT_MS, null);
    if (details?.url && details.title) return details;
  }
  return null;
}

export async function fetchCsfdSeriesStreamingItemsFromCandidates(
  candidates: RadarItem[],
  rangeStart: string,
  rangeEnd: string,
) {
  const seriesCandidates = new Map<string, RadarItem>();
  for (const candidate of candidates) {
    if (candidate.mediaType !== "series" || candidate.channel !== "streaming") continue;
    const key = `${candidate.tmdbId}-${stripAnySeasonSuffix(candidate.title) ?? candidate.title}`;
    if (!seriesCandidates.has(key)) seriesCandidates.set(key, candidate);
  }

  const items = await mapConcurrent<RadarItem, RadarItem | null>(
    [...seriesCandidates.values()],
    LOOKUP_CONCURRENCY,
    async (candidate) => {
      const root = await findRootSeriesCandidateFromQueries(buildRootSeriesQueries(candidate));
      if (!root) return null;

      const details = await withTimeout(csfdClient.movie(root.id), LOOKUP_TIMEOUT_MS, null);
      if (!details?.url || !details.title) return null;

      const vodPremieres = selectCzechVodPremieres(details.premieres ?? [], { channel: "streaming" })
        .filter((premiere) => premiere.date >= rangeStart && premiere.date <= rangeEnd);
      if (vodPremieres.length === 0) return null;

      const titleSuffix = extractSeasonSuffix(candidate.title) ?? extractSeasonSuffix(candidate.originalTitle);
      const title = formatPrimaryStreamingTitle(details.title, details.seasonName, titleSuffix ?? undefined);
      const ratingDetails = await loadSeriesRatingDetails(details, "series");
      const releaseDate = vodPremieres[0].date;
      const csfdMatch: RadarCsfdMatch = {
        title,
        rating: numberOrNull(ratingDetails.rating),
        ratingCount: numberOrNull(ratingDetails.ratingCount),
        url: ratingDetails.url,
        releaseDate,
        vodPremieres,
      };

      return {
        ...candidate,
        id: `series-${candidate.tmdbId}-csfd-root-streaming-${releaseDate}`,
        title,
        originalTitle: stripAnySeasonSuffix(candidate.originalTitle),
        releaseDate,
        posterUrl: candidate.posterUrl ?? optimizeCsfdPoster(details.poster ?? null),
        overview: candidate.overview || details.descriptions?.[0] || "",
        providers: [],
        watchUrl: null,
        csfd: csfdMatch,
      } satisfies RadarItem;
    },
  );

  return items.filter((item): item is RadarItem => item !== null);
}

export function formatPrimaryStreamingTitle(title: string, seasonName: string | null | undefined, titleSuffix?: string) {
  if (titleSuffix && !title.toLocaleLowerCase("cs-CZ").endsWith(titleSuffix.toLocaleLowerCase("cs-CZ"))) {
    return `${title} - ${titleSuffix}`;
  }
  return formatSeasonTitle(title, seasonName);
}

async function loadSeriesRatingDetails(details: CSFDMovie, mediaType: RadarMediaType) {
  if (mediaType !== "series") {
    return {
      url: details.url,
      rating: details.rating,
      ratingCount: details.ratingCount,
    };
  }

  const rootId = isNestedCsfdSeasonUrl(details.url)
    ? extractRootCsfdFilmId(details.url)
    : null;

  if (rootId) {
    const rootDetails = await withTimeout(csfdClient.movie(rootId), LOOKUP_TIMEOUT_MS, null);
    if (rootDetails?.url) {
      return {
        url: rootDetails.url,
        rating: rootDetails.rating,
        ratingCount: rootDetails.ratingCount,
      };
    }
  }

  if (details.seasonName) {
    const rootCandidate = await findRootSeriesCandidate(details.title);
    const fallbackRoot = rootCandidate
      ? await withTimeout(csfdClient.movie(rootCandidate.id), LOOKUP_TIMEOUT_MS, null)
      : null;
    if (fallbackRoot?.url) {
      return {
        url: fallbackRoot.url,
        rating: fallbackRoot.rating,
        ratingCount: fallbackRoot.ratingCount,
      };
    }
  }

  return {
    url: createRootCsfdUrl(details.url),
    rating: details.rating,
    ratingCount: details.ratingCount,
  };
}

async function findRootSeriesCandidate(title: string) {
  return findRootSeriesCandidateFromQueries([title]);
}

async function findRootSeriesCandidateFromQueries(queries: string[]) {
  try {
    const searched = [];
    for (const query of queries) {
      const result = await csfdClient.search(query);
      const rootCandidates = (result.tvSeries ?? []).filter(isRootSeriesSearchResult);
      searched.push({ query, rootCandidates });
      const exactCandidate = selectRootSeriesCandidate(rootCandidates, query);
      if (exactCandidate) return exactCandidate;
    }

    for (const { query, rootCandidates } of searched) {
      const detailedCandidate = await selectRootSeriesCandidateByDetails(rootCandidates, query);
      if (detailedCandidate) return detailedCandidate;
    }
    return null;
  } catch (error) {
    console.warn(`Radar CSFD root series lookup failed for "${queries.join(", ")}"`, error);
    return null;
  }
}

async function selectRootSeriesCandidateByDetails(candidates: CSFDSearchMovie[], query: string) {
  for (const candidate of candidates.slice(0, 5)) {
    const details = await withTimeout(csfdClient.movie(candidate.id), LOOKUP_TIMEOUT_MS, null);
    if (isDetailedTitleMatch(candidate, details, query)) return candidate;
  }
  return null;
}

async function loadMatch(item: RadarItem) {
  const key = cacheKey(item);
  const store = getStore(CACHE_STORE, { consistency: "strong" });

  try {
    const cached = await store.get(key, { type: "json" }) as CachedRadarCsfd | null;
    if (cached && isCachedRadarCsfdFresh(cached) && shouldReuseCachedRadarCsfd(item, cached)) {
      return cached.match;
    }
  } catch (error) {
    console.warn(`Radar CSFD cache read failed for "${item.title}"`, error);
  }

  const result = await withTimeout(lookupMatch(item), MATCH_TIMEOUT_MS, { status: "error" } satisfies RadarCsfdLookupResult);
  const cached = createCachedRadarCsfd(result);
  if (cached) {
    try {
      await store.setJSON(key, cached);
    } catch (error) {
      console.warn(`Radar CSFD cache write failed for "${item.title}"`, error);
    }
  }
  return result.status === "matched" ? result.match : null;
}

async function lookupMatch(item: RadarItem): Promise<RadarCsfdLookupResult> {
  const outcome = await resolveCsfdTitle({
    titles: buildLookupQueries(item),
    kind: item.mediaType,
    year: Number(item.releaseDate.slice(0, 4)),
  });
  if (outcome.status !== "matched") return { status: outcome.status };

  const { candidate, details } = outcome;
  const ratingDetails = details ? await loadSeriesRatingDetails(details, item.mediaType) : null;
  const url = ratingDetails?.url ?? candidate.url;
  if (!url) return { status: "not_found" };

  return {
    status: "matched",
    match: {
      title: details ? formatSeasonTitle(details.title, details.seasonName) : normalizeSeasonTitle(candidate.title),
      rating: numberOrNull(ratingDetails?.rating ?? details?.rating),
      ratingCount: numberOrNull(ratingDetails?.ratingCount ?? details?.ratingCount),
      url,
      releaseDate: selectCzechStreamingDate(details?.premieres ?? [], item),
      vodPremieres: selectCzechVodPremieres(details?.premieres ?? [], item)
    }
  };
}

export function buildLookupQueries(item: Pick<RadarItem, "mediaType" | "title" | "originalTitle">) {
  const queries = item.mediaType === "series"
    ? [item.title, item.originalTitle, stripAnySeasonSuffix(item.title), stripAnySeasonSuffix(item.originalTitle)]
    : [item.title, item.originalTitle];
  return queries.filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
}

export function buildRootSeriesQueries(item: Pick<RadarItem, "title" | "originalTitle">) {
  const queries = [
    stripAnySeasonSuffix(item.title) ?? item.title,
    stripAnySeasonSuffix(item.originalTitle) ?? item.originalTitle,
  ];
  return queries.filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
}

export function isCachedRadarCsfdFresh(entry: CachedRadarCsfd, now = Date.now()) {
  const checkedAt = Date.parse(entry.checkedAt);
  if (!Number.isFinite(checkedAt)) return false;
  const ttl = entry.status === "matched" ? MATCHED_TTL_MS : NOT_FOUND_TTL_MS;
  return now - checkedAt <= ttl;
}

export function createCachedRadarCsfd(
  result: RadarCsfdLookupResult,
  checkedAt = new Date().toISOString(),
): CachedRadarCsfd | null {
  if (result.status === "error") return null;
  return result.status === "matched"
    ? { status: "matched", checkedAt, match: result.match }
    : { status: "not_found", checkedAt, match: null };
}

export function shouldReuseRadarCsfdMatch(item: Pick<RadarItem, "mediaType" | "csfd">) {
  return Boolean(item.csfd && shouldReuseCsfdUrl(item.mediaType, item.csfd.url));
}

function shouldReuseCachedRadarCsfd(item: Pick<RadarItem, "mediaType">, cached: CachedRadarCsfd) {
  return !cached.match || shouldReuseCsfdUrl(item.mediaType, cached.match.url);
}

function shouldReuseCsfdUrl(mediaType: RadarMediaType, url: string) {
  return mediaType !== "series" || !isNestedCsfdSeasonUrl(url);
}

function selectCzechStreamingDate(
  premieres: Array<{ format: string; date: string; company: string }>,
  item: RadarItem
) {
  if (item.channel !== "streaming") return null;
  return selectCzechVodPremieres(premieres, item)[0]?.date
    ?? selectDisneyTvPremieres(premieres, item)[0]?.date
    ?? null;
}

export function selectCzechVodPremieres(
  premieres: Array<{ format: string; date: string; company: string }>,
  item: Pick<RadarItem, "channel">
): RadarCsfdVodPremiere[] {
  if (item.channel !== "streaming") return [];

  const unique = new Map<string, RadarCsfdVodPremiere>();
  for (const premiere of premieres) {
    if (!comparableTitle(premiere.format).includes("na vod")) continue;
    const provider = getProviderMetadata(premiere.company);
    if (!provider) continue;
    const date = normalizePremiereDate(premiere.date);
    if (!date) continue;
    unique.set(`${date}-${provider.id}`, { date, provider: provider.name });
  }

  return [...unique.values()].sort((left, right) => (
    left.date.localeCompare(right.date) || left.provider.localeCompare(right.provider, "cs-CZ")
  ));
}

function selectDisneyTvPremieres(
  premieres: Array<{ format: string; date: string; company: string }>,
  item: Pick<RadarItem, "channel">
): RadarCsfdVodPremiere[] {
  if (item.channel !== "streaming") return [];

  const unique = new Map<string, RadarCsfdVodPremiere>();
  for (const premiere of premieres) {
    if (!comparableTitle(premiere.format).includes("v tv")) continue;
    if (!comparableTitle(premiere.company).includes("disney channel")) continue;
    const date = normalizePremiereDate(premiere.date);
    if (!date) continue;
    unique.set(`${date}-disney-channel`, { date, provider: "Disney Channel" });
  }

  return [...unique.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function selectRootSeriesCandidate(candidates: CSFDSearchMovie[], title: string) {
  const normalizedTitle = comparableTitle(title);
  return candidates
    .filter((candidate) => isRootSeriesSearchResult(candidate) && comparableTitle(candidate.title) === normalizedTitle)
    .sort((left, right) => right.year - left.year)[0] ?? null;
}

function isRootSeriesSearchResult(candidate: CSFDSearchMovie) {
  return candidate.type === "series" || candidate.type === "tv-show";
}

/** Does the search result, or any title on its detail page, carry the queried title? */
export function isDetailedTitleMatch(candidate: CSFDSearchMovie, details: CSFDMovie | null, query: string) {
  const titles = [
    candidate.title,
    details?.title,
    ...(details?.titlesOther ?? []).map((title) => title.title),
  ];
  return titles
    .filter((value): value is string => Boolean(value))
    .some((title) => titleSimilarity(title, query) >= 72);
}

function cacheKey(item: RadarItem) {
  return `${CACHE_VERSION}/${item.mediaType}/${item.releaseDate.slice(0, 4)}/${slugify(item.title)}`;
}

function stripAnySeasonSuffix(value: string | null) {
  return value?.replace(/\s*-\s*(?:s(?:\u00e9|e|\u00c3\u00a9)rie|serie|season)\s+\d+\s*$/iu, "").trim() || null;
}

function extractSeasonSuffix(value: string | null) {
  const match = value?.match(/(?:s(?:\u00e9|e|\u00c3\u00a9)rie|serie|season)\s+(\d+)/iu);
  return match ? `S\u00e9rie ${match[1]}` : null;
}

function formatSeasonTitle(title: string, seasonName?: string | null) {
  return seasonName ? `${title} - ${normalizeSeasonTitle(seasonName)}` : normalizeSeasonTitle(title);
}

export function normalizeSeasonTitle(value: string) {
  return value.replace(/\b(?:season|serie|série)\s+(\d+)\b/giu, "Série $1");
}

export function extractRootCsfdFilmId(url: string | null | undefined) {
  if (!url) return null;
  const match = url.match(/\/film\/(\d+)(?:[-/]|$)/);
  return match ? Number(match[1]) : null;
}

export function createRootCsfdUrl(url: string) {
  const match = url.match(/^(https?:\/\/www\.csfd\.cz\/film\/\d+(?:-[^/]+)?\/)/);
  return match ? `${match[1]}prehled/` : url;
}

function isNestedCsfdSeasonUrl(url: string) {
  return /\/film\/\d+(?:-[^/]+)?\/\d+(?:-[^/]+)?\//.test(url);
}

function optimizeCsfdPoster(url: string | null) {
  if (!url) return null;
  return url.replace(/\/cache\/resized\/w\d+(?:h\d+)?\//, "/cache/resized/w360/");
}

function slugify(value: string) {
  return comparableTitle(value).replace(/\s+/g, "-") || "title";
}

function normalizePremiereDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T) {
  return new Promise<T>((resolve) => {
    const timeout = setTimeout(() => resolve(fallback), ms);
    promise.then(resolve).catch(() => resolve(fallback)).finally(() => clearTimeout(timeout));
  });
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
