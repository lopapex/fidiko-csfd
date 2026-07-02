import { getStore } from "@netlify/blobs";
import { csfd, type CSFDMovie, type CSFDSearchMovie } from "node-csfd-api";
import type { RadarItem, RadarMediaType } from "./radar-refresh";
import { getProviderMetadata } from "./radar-providers";

const CACHE_STORE = "radar-csfd-cache";
const CACHE_VERSION = "v10";
const LOOKUP_CONCURRENCY = 8;
const LOOKUP_TIMEOUT_MS = 5000;
const MATCHED_TTL_MS = 7 * 86_400_000;
const NOT_FOUND_TTL_MS = 86_400_000;

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
    item.csfd ?? await loadMatch(item)
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
  const items = await mapConcurrent<CsfdPrimaryStreamingSeed, RadarItem | null>(seeds, LOOKUP_CONCURRENCY, async (seed) => {
    const details = await withTimeout(csfd.movie(seed.csfdId), LOOKUP_TIMEOUT_MS, null);
    if (!details?.url || !details?.title) return null;
    const ratingDetails = await loadSeriesRatingDetails(details, seed.mediaType);

    const title = formatPrimaryStreamingTitle(details.title, details.seasonName, seed.titleSuffix);
    const vodPremieres = selectCzechVodPremieres(details.premieres ?? [], { channel: "streaming" });
    const csfdMatch: RadarCsfdMatch = {
      title,
      rating: numberOrNull(ratingDetails.rating),
      ratingCount: numberOrNull(ratingDetails.ratingCount),
      url: ratingDetails.url,
      releaseDate: vodPremieres[0]?.date ?? null,
      vodPremieres,
    };
    if (!csfdMatch.releaseDate || csfdMatch.vodPremieres.length === 0) return null;

    const item: RadarItem = {
      id: `${seed.mediaType}-csfd-${seed.csfdId}-streaming-${csfdMatch.releaseDate}`,
      tmdbId: -seed.csfdId,
      mediaType: seed.mediaType,
      channel: "streaming",
      title,
      originalTitle: null,
      overview: details.descriptions?.[0] ?? "",
      posterUrl: optimizeCsfdPoster(details.poster ?? null),
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

  const rootId = extractRootCsfdFilmId(details.url);
  if (!rootId) {
    return {
      url: details.url,
      rating: details.rating,
      ratingCount: details.ratingCount,
    };
  }

  const rootDetails = await withTimeout(csfd.movie(rootId), LOOKUP_TIMEOUT_MS, null);
  return {
    url: rootDetails?.url ?? createRootCsfdUrl(details.url),
    rating: rootDetails?.rating ?? details.rating,
    ratingCount: rootDetails?.ratingCount ?? details.ratingCount,
  };
}

async function loadMatch(item: RadarItem) {
  const key = cacheKey(item);
  const store = getStore(CACHE_STORE, { consistency: "strong" });

  try {
    const cached = await store.get(key, { type: "json" }) as CachedRadarCsfd | null;
    if (cached && isCachedRadarCsfdFresh(cached)) {
      return cached.match;
    }
  } catch (error) {
    console.warn(`Radar CSFD cache read failed for "${item.title}"`, error);
  }

  const result = await withTimeout(lookupMatch(item), LOOKUP_TIMEOUT_MS, { status: "error" } satisfies RadarCsfdLookupResult);
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
  let failed = false;
  for (const query of buildLookupQueries(item)) {
    try {
      const result = await csfd.search(query);
      const candidates = item.mediaType === "series"
        ? [...result.tvSeries, ...result.movies]
        : [...result.movies, ...result.tvSeries];
      for (const match of selectCandidates(candidates, item, query)) {
        const details = await withTimeout(csfd.movie(match.id), LOOKUP_TIMEOUT_MS, null);
        if (!isDetailedTitleMatch(match, details, query)) continue;
        const ratingDetails = details
          ? await loadSeriesRatingDetails(details, item.mediaType)
          : null;
        const url = ratingDetails?.url ?? match.url;
        if (!url) continue;
        const title = details ? formatSeasonTitle(details.title, details.seasonName) : normalizeSeasonTitle(match.title);

        return {
          status: "matched",
          match: {
            title,
            rating: numberOrNull(ratingDetails?.rating ?? details?.rating),
            ratingCount: numberOrNull(ratingDetails?.ratingCount ?? details?.ratingCount),
            url,
            releaseDate: selectCzechStreamingDate(details?.premieres ?? [], item),
            vodPremieres: selectCzechVodPremieres(details?.premieres ?? [], item)
          }
        };
      }
    } catch (error) {
      failed = true;
      console.warn(`Radar CSFD lookup failed for "${query}"`, error);
    }
  }
  return failed ? { status: "error" } : { status: "not_found" };
}

export function buildLookupQueries(item: Pick<RadarItem, "mediaType" | "title" | "originalTitle">) {
  const queries = item.mediaType === "series"
    ? [item.title, item.originalTitle, stripSeasonSuffix(item.title), stripSeasonSuffix(item.originalTitle)]
    : [item.title, item.originalTitle];
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

function selectCzechStreamingDate(
  premieres: Array<{ format: string; date: string; company: string }>,
  item: RadarItem
) {
  if (item.channel !== "streaming") return null;
  return selectCzechVodPremieres(premieres, item)[0]?.date ?? null;
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

export function selectCandidates(candidates: CSFDSearchMovie[], item: RadarItem, query: string) {
  const normalizedQuery = comparableTitle(query);
  const year = Number(item.releaseDate.slice(0, 4));

  return candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate, normalizedQuery, year, item.mediaType) }))
    .filter(({ score }) => score >= 55)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map(({ candidate }) => candidate);
}

function scoreCandidate(candidate: CSFDSearchMovie, query: string, year: number, mediaType: RadarMediaType) {
  const title = comparableTitle(candidate.title);
  const titleMatches = isPlausibleTitleMatch(title, query);

  let score = titleMatches ? (title === query ? 100 : 65) : 0;
  const yearDifference = Math.abs(candidate.year - year);
  score += yearDifference === 0 ? 40 : yearDifference === 1 ? 20 : -Math.min(50, yearDifference * 10);

  const isSeries = candidate.type === "series" || candidate.type === "tv-show" || candidate.type === "season";
  if ((mediaType === "series") === isSeries) score += 20;
  if (!titleMatches && (yearDifference > 1 || (mediaType === "series") !== isSeries)) return -Infinity;
  return score;
}

export function isDetailedTitleMatch(candidate: CSFDSearchMovie, details: CSFDMovie | null, query: string) {
  const normalizedQuery = comparableTitle(query);
  const titles = [
    candidate.title,
    details?.title,
    ...(details?.titlesOther ?? []).map((title) => title.title),
  ];
  return titles
    .filter((value): value is string => Boolean(value))
    .map(comparableTitle)
    .some((title) => isPlausibleTitleMatch(title, normalizedQuery));
}

function cacheKey(item: RadarItem) {
  return `${CACHE_VERSION}/${item.mediaType}/${item.releaseDate.slice(0, 4)}/${slugify(item.title)}`;
}

function comparableTitle(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stripSeasonSuffix(value: string | null) {
  return value?.replace(/\s*-\s*(?:série|serie|season)\s+\d+\s*$/iu, "").trim() || null;
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

function optimizeCsfdPoster(url: string | null) {
  if (!url) return null;
  return url.replace(/\/cache\/resized\/w\d+(?:h\d+)?\//, "/cache/resized/w360/");
}

function isPlausibleTitleMatch(candidate: string, query: string) {
  if (!candidate || !query) return false;
  if (candidate === query || candidate.includes(query) || query.includes(candidate)) return true;
  const candidateWords = new Set(candidate.split(" ").filter((word) => word.length > 2));
  const queryWords = query.split(" ").filter((word) => word.length > 2);
  return queryWords.length > 0 && queryWords.filter((word) => candidateWords.has(word)).length / queryWords.length >= 0.75;
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
