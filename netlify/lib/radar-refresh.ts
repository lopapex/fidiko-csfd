import { getStore } from "@netlify/blobs";
import { enrichRadarItemsWithCsfd, fetchCsfdPrimaryStreamingItems, fetchCsfdSeriesStreamingItemsFromCandidates, type CsfdPrimaryStreamingSeed, type RadarCsfdMatch } from "./radar-csfd";
import { cleanupRadarWeekCache, getRadarStore, getStaleRadarWeekKeys, RADAR_CACHE_KEY, RADAR_WEEK_CACHE_VERSION, readRadarSnapshot } from "./radar-cache";
import { patchItemsWithFreshCsfdRatings } from "./csfd-ratings";
import { decideRadarItemsForSnapshot, prepareRadarItemsForSnapshot, type RadarDecisionDiagnostics } from "./radar-decision";
import { deduplicateRadarItems, normalizeRadarTitle } from "./radar-deduplication";
import { discoverMovies, discoverSeries, getSeriesDiscoveryDateFilters, isHiddenProvider } from "./radar-discovery";
import { getProviderLink, type ProviderLinkType } from "./radar-providers";
import { TMDB_IMAGE_BASE, tmdbFetch, type TmdbDiscoverItem, type TmdbProvider, type TmdbTvDetails, type TmdbWatchResponse } from "./radar-tmdb";
import { mapConcurrent } from "./shared/concurrency";
import { addDaysISO, getPragueNow, getPragueTodayISO, startOfISOWeek } from "./shared/date";
import { decodeHtmlEntities } from "./text";
import type { ScheduleResponse } from "./schedule-scraper";

const SCHEDULE_CACHE_STORE = "schedule-cache";
const SCHEDULE_CACHE_KEY = "current-v2";
const MAX_SERIES_CANDIDATES = 120;
const PRECOMPUTE_PAST_WEEKS = 5;
const PRECOMPUTE_FUTURE_WEEKS = 12;
const WEEK_REFRESH_CONCURRENCY = 2;
const PROVIDER_CONCURRENCY = 6;
const STREAMING_DISCOVERY_MARGIN_DAYS = 3;

type ManualRadarOverride = CsfdPrimaryStreamingSeed & {
  reason?: string;
  expiresOn?: string;
};

const MANUAL_RADAR_OVERRIDES: ManualRadarOverride[] = [
  { csfdId: 1684377, mediaType: "series" },
  { csfdId: 1654643, mediaType: "series" },
  { csfdId: 1494570, mediaType: "series" },
  { csfdId: 1552381, mediaType: "series" },
  { csfdId: 1140499, mediaType: "series", titleSuffix: "Série 2" },
  { csfdId: 1184280, mediaType: "series", titleSuffix: "Série 5" },
];

export const getActiveManualRadarOverrides = (
  overrides: ManualRadarOverride[] = MANUAL_RADAR_OVERRIDES,
  today = getPragueTodayISO(),
): CsfdPrimaryStreamingSeed[] =>
  overrides
    .filter((override) => !override.expiresOn || override.expiresOn >= today)
    .map(({ csfdId, mediaType, titleSuffix }) => ({ csfdId, mediaType, titleSuffix }));

export type RadarMediaType = "movie" | "series";
export type RadarChannel = "cinema" | "streaming";

export type RadarProvider = {
  id: number;
  name: string;
  logoUrl: string;
  url: string | null;
  linkType?: ProviderLinkType;
  mobileUrl?: string;
  mobileLinkType?: ProviderLinkType;
};

export type RadarProgramMatch = {
  filmId: string;
  firstScreeningDate: string;
  screeningCount: number;
  upcomingScreeningCount: number;
  nextScreening: {
    dateISO: string;
    time: string | null;
  } | null;
};

export type RadarItem = {
  id: string;
  tmdbId: number;
  mediaType: RadarMediaType;
  channel: RadarChannel;
  title: string;
  originalTitle: string | null;
  overview: string;
  posterUrl: string | null;
  releaseDate: string;
  providers: RadarProvider[];
  watchUrl: string | null;
  csfd: RadarCsfdMatch | null;
  program: RadarProgramMatch | null;
};

export type RadarSnapshot = {
  fetchedAt: string;
  range: { start: string; end: string };
  sources: Record<RadarSource, RadarSourceState>;
  items: RadarItem[];
};

export type RadarSource = "cinemaMovies" | "streamingMovies" | "streamingSeries";
export type RadarSourceState = {
  status: "fresh" | "carried" | "failed";
  fetchedAt: string | null;
  diagnostics?: RadarDecisionDiagnostics;
};

export type ItemSourceResult = { items: RadarItem[]; succeeded: boolean };

export async function hasRadarCache() {
  const store = getRadarStore();
  return Boolean(await store.get(RADAR_CACHE_KEY));
}

export async function refreshRadarCache(): Promise<RadarSnapshot> {
  const today = getPragueTodayISO();
  const currentWeek = startOfISOWeek(today);
  const weekStarts = getRadarPrecomputeWeekStarts(currentWeek);
  const store = getRadarStore();
  const snapshots = await mapConcurrent(weekStarts, WEEK_REFRESH_CONCURRENCY, async (weekStart) => {
    const key = `${RADAR_WEEK_CACHE_VERSION}/${weekStart}`;
    const previous = await readRadarSnapshot(store, key);
    const snapshot = await buildRadarSnapshot(weekStart, addDaysISO(weekStart, 6), previous);
    await store.setJSON(key, snapshot);
    return snapshot;
  });
  const aggregate = aggregateWeekSnapshots(snapshots);
  await store.setJSON(RADAR_CACHE_KEY, aggregate);
  await cleanupRadarWeekCache(store, new Set(weekStarts));
  return aggregate;
}

export function getRadarPrecomputeWeekStarts(currentWeek: string) {
  return Array.from(
    { length: PRECOMPUTE_PAST_WEEKS + PRECOMPUTE_FUTURE_WEEKS + 1 },
    (_, index) => addDaysISO(currentWeek, (index - PRECOMPUTE_PAST_WEEKS) * 7),
  );
}

export async function refreshRadarWeek(weekStart: string): Promise<RadarSnapshot> {
  const store = getRadarStore();
  const key = `${RADAR_WEEK_CACHE_VERSION}/${weekStart}`;
  const previous = await readRadarSnapshot(store, key);
  const snapshot = await buildRadarSnapshot(weekStart, addDaysISO(weekStart, 6), previous);
  await store.setJSON(key, snapshot);
  return snapshot;
}

async function buildRadarSnapshot(
  rangeStart: string,
  rangeEnd: string,
  previous: RadarSnapshot | null,
) {
  const totalStarted = performance.now();
  const token = process.env.TMDB_API_TOKEN?.trim();
  if (!token) {
    throw new Error("TMDB_API_TOKEN is not configured");
  }

  const discoveryStarted = performance.now();
  const streamingRangeStart = addDaysISO(rangeStart, -STREAMING_DISCOVERY_MARGIN_DAYS);
  const streamingRangeEnd = addDaysISO(rangeEnd, STREAMING_DISCOVERY_MARGIN_DAYS);
  const [cinemaMovies, streamingMovies, streamingSeries, csfdStreaming, schedule] = await Promise.all([
    discoverMovies(token, rangeStart, rangeEnd, "2|3"),
    discoverMovies(token, streamingRangeStart, streamingRangeEnd, "4"),
    discoverSeries(token, streamingRangeStart, streamingRangeEnd),
    fetchCsfdPrimaryStreamingItems(getActiveManualRadarOverrides()),
    readScheduleCache()
  ]);
  const discoveryMs = performance.now() - discoveryStarted;

  const providersStarted = performance.now();
  const cinemaSource: ItemSourceResult = {
    items: cinemaMovies.items.map((item) => createRadarItem(item, "movie", "cinema", null)),
    succeeded: cinemaMovies.succeeded,
  };
  const movieStreamingSource = streamingMovies.succeeded
    ? await enrichStreamingItems(token, streamingMovies.items, "movie")
    : { items: [], succeeded: false };
  const resolvedSeries = streamingSeries.succeeded
    ? await resolveSeriesPremieres(token, streamingSeries.items.slice(0, MAX_SERIES_CANDIDATES), streamingRangeStart, streamingRangeEnd)
    : { items: [], succeeded: false };
  const seriesStreamingSource = resolvedSeries.succeeded
    ? await enrichStreamingItems(token, resolvedSeries.items, "series")
    : { items: [], succeeded: false };
  const providersMs = performance.now() - providersStarted;

  const csfdDiscoveryStarted = performance.now();
  const csfdDiscoveredSeries = seriesStreamingSource.succeeded
    ? await fetchCsfdSeriesStreamingItemsFromCandidates(seriesStreamingSource.items, rangeStart, rangeEnd)
    : [];
  const csfdDiscoveryMs = performance.now() - csfdDiscoveryStarted;

  const builtAt = new Date().toISOString();
  const cinema = resolveSource("cinemaMovies", cinemaSource, previous, rangeStart, rangeEnd, builtAt);
  const movies = resolveSource("streamingMovies", movieStreamingSource, previous, rangeStart, rangeEnd, builtAt);
  const series = resolveSource("streamingSeries", seriesStreamingSource, previous, rangeStart, rangeEnd, builtAt);
  const sources: RadarSnapshot["sources"] = {
    cinemaMovies: cinema.state,
    streamingMovies: movies.state,
    streamingSeries: series.state,
  };

  if (Object.values(sources).every((source) => source.status === "failed")) {
    throw new Error("TMDb discovery is temporarily unavailable");
  }

  const csfdStarted = performance.now();
  const discoveredItems = [...cinema.items, ...movies.items, ...series.items, ...csfdStreaming, ...csfdDiscoveredSeries];
  const seededItems = seedItemsWithKnownCsfd(discoveredItems, previous, schedule);
  const enrichedItems = await enrichRadarItemsWithCsfd(seededItems);
  const csfdMs = performance.now() - csfdStarted;
  const linkingStarted = performance.now();
  const decision = decideRadarItemsForSnapshot(enrichedItems, rangeStart, rangeEnd);
  sources.streamingSeries = {
    ...sources.streamingSeries,
    diagnostics: decision.diagnostics,
  };
  const items = (await patchItemsWithFreshCsfdRatings(
    linkProgramMatches(decision.items, schedule)
  )).sort(compareItems);
  const linkingMs = performance.now() - linkingStarted;
  const csfdMatches = items.filter((item) => item.csfd?.url).length;
  const programMatches = items.filter((item) => item.program).length;
  console.log("Radar refresh metrics", {
    rangeStart,
    rangeEnd,
    items: items.length,
    csfdMatches,
    missingCsfdMatches: items.length - csfdMatches,
    programMatches,
    scheduleCacheHit: Boolean(schedule),
    sources,
    decision: decision.diagnostics,
    timingsMs: {
      discovery: Math.round(discoveryMs),
      providers: Math.round(providersMs),
      csfdDiscovery: Math.round(csfdDiscoveryMs),
      csfd: Math.round(csfdMs),
      linking: Math.round(linkingMs),
      total: Math.round(performance.now() - totalStarted)
    }
  });
  return {
    fetchedAt: builtAt,
    range: { start: rangeStart, end: rangeEnd },
    sources,
    items
  } satisfies RadarSnapshot;
}

export { getSeriesDiscoveryDateFilters, getStaleRadarWeekKeys, isHiddenProvider, prepareRadarItemsForSnapshot };

export function resolveSource(
  source: RadarSource,
  fresh: ItemSourceResult,
  previous: RadarSnapshot | null,
  rangeStart: string,
  rangeEnd: string,
  builtAt: string,
) {
  if (fresh.succeeded) {
    return {
      items: fresh.items,
      state: { status: "fresh", fetchedAt: builtAt } satisfies RadarSourceState,
    };
  }

  const canCarry = previous && rangeStart >= previous.range.start && rangeEnd <= previous.range.end;
  const carried = canCarry
    ? previous.items.filter((item) => belongsToSource(item, source) && item.releaseDate >= rangeStart && item.releaseDate <= rangeEnd)
    : [];
  const previousState = previous?.sources?.[source];
  return {
    items: carried,
    state: {
      status: carried.length > 0 ? "carried" : "failed",
      fetchedAt: carried.length > 0 ? previousState?.fetchedAt ?? previous?.fetchedAt ?? null : null,
    } satisfies RadarSourceState,
  };
}

function belongsToSource(item: RadarItem, source: RadarSource) {
  if (source === "cinemaMovies") return item.mediaType === "movie" && item.channel === "cinema";
  if (source === "streamingMovies") return item.mediaType === "movie" && item.channel === "streaming";
  return item.mediaType === "series" && item.channel === "streaming";
}

function aggregateWeekSnapshots(snapshots: RadarSnapshot[]): RadarSnapshot {
  const ordered = [...snapshots].sort((left, right) => left.range.start.localeCompare(right.range.start));
  const rangeStart = ordered[0]?.range.start ?? startOfISOWeek(getPragueTodayISO());
  const rangeEnd = ordered[ordered.length - 1]?.range.end ?? addDaysISO(rangeStart, 6);
  const sources = Object.fromEntries((["cinemaMovies", "streamingMovies", "streamingSeries"] as RadarSource[]).map((source) => {
    const failed = ordered.filter((snapshot) => snapshot.sources[source].status === "failed");
    const latest = [...ordered].reverse().find((snapshot) => snapshot.sources[source].fetchedAt)?.sources[source];
    return [source, {
      status: failed.length === ordered.length ? "failed" : "fresh",
      fetchedAt: latest?.fetchedAt ?? null,
      diagnostics: combineDiagnostics(ordered.map((snapshot) => snapshot.sources[source].diagnostics)),
    } satisfies RadarSourceState];
  })) as Record<RadarSource, RadarSourceState>;

  return {
    fetchedAt: new Date().toISOString(),
    range: { start: rangeStart, end: rangeEnd },
    sources,
    items: deduplicateItems(ordered.flatMap((snapshot) => snapshot.items)),
  };
}

const combineDiagnostics = (items: Array<RadarDecisionDiagnostics | undefined>) => {
  const diagnostics = items.filter((item): item is RadarDecisionDiagnostics => Boolean(item));
  if (diagnostics.length === 0) return undefined;
  return diagnostics.reduce<RadarDecisionDiagnostics>((total, item) => {
    total.discovered += item.discovered;
    total.resolved += item.resolved;
    total.published += item.published;
    for (const [reason, count] of Object.entries(item.rejectedByReason)) {
      const key = reason as keyof RadarDecisionDiagnostics["rejectedByReason"];
      total.rejectedByReason[key] = (total.rejectedByReason[key] ?? 0) + (count ?? 0);
    }
    return total;
  }, { discovered: 0, resolved: 0, published: 0, rejectedByReason: {} });
};

async function resolveSeriesPremieres(
  token: string,
  candidates: TmdbDiscoverItem[],
  start: string,
  end: string,
): Promise<{ items: TmdbDiscoverItem[]; succeeded: boolean }> {
  const resolved = await mapConcurrent(candidates, PROVIDER_CONCURRENCY, async (candidate) => {
    try {
      const details = await tmdbFetch<TmdbTvDetails>(token, `/tv/${candidate.id}?language=cs-CZ`);
      const seasons = (details.seasons ?? []).filter((season) =>
        season.season_number > 0 && Boolean(season.air_date) && season.air_date! >= start && season.air_date! <= end
      );
      if (candidate.first_air_date && candidate.first_air_date >= start && candidate.first_air_date <= end) {
        return {
          succeeded: true,
          items: [{
            ...candidate,
            name: details.name ?? candidate.name,
            original_name: details.original_name ?? candidate.original_name,
            overview: details.overview ?? candidate.overview,
            poster_path: details.poster_path ?? candidate.poster_path,
          }],
        };
      }

      return {
        succeeded: true,
        items: seasons.map((season) => ({
          ...candidate,
          name: `${details.name ?? candidate.name} - Série ${season.season_number}`,
          original_name: `${details.original_name ?? candidate.original_name ?? candidate.name} - Série ${season.season_number}`,
          overview: details.overview ?? candidate.overview,
          poster_path: season.poster_path ?? details.poster_path ?? candidate.poster_path,
          first_air_date: season.air_date ?? undefined
        })),
      };
    } catch (error) {
      console.warn(`TMDb seasons for series ${candidate.id} were skipped`, error);
      return { succeeded: false, items: [] };
    }
  });

  return {
    items: resolved.flatMap((result) => result.items),
    succeeded: candidates.length === 0 || resolved.some((result) => result.succeeded),
  };
}

async function enrichStreamingItems(
  token: string,
  candidates: TmdbDiscoverItem[],
  mediaType: RadarMediaType,
): Promise<ItemSourceResult> {
  const enriched = await mapConcurrent(candidates, PROVIDER_CONCURRENCY, async (item) => {
    let watch: TmdbWatchResponse;
    try {
      watch = await tmdbFetch<TmdbWatchResponse>(
        token,
        mediaType === "movie" ? `/movie/${item.id}/watch/providers` : `/tv/${item.id}/watch/providers`
      );
    } catch (error) {
      console.warn(`TMDb providers for ${mediaType} ${item.id} were skipped`, error);
      return { succeeded: false, item: null };
    }
    const region = watch.results?.CZ;
    if (!region) {
      return { succeeded: true, item: createRadarItem(item, mediaType, "streaming", { providers: [], watchUrl: null }) };
    }

    const title = mediaType === "movie" ? item.title : item.name;
    const providers = deduplicateProviders(
      [...(region.flatrate ?? []), ...(region.free ?? []), ...(region.ads ?? [])],
      title,
    );
    if (providers.length === 0) {
      return {
        succeeded: true,
        item: createRadarItem(item, mediaType, "streaming", { providers: [], watchUrl: region.link ?? null }),
      };
    }

    return {
      succeeded: true,
      item: createRadarItem(item, mediaType, "streaming", { providers, watchUrl: region.link ?? null }),
    };
  });

  return {
    items: enriched.map((result) => result.item).filter((item): item is RadarItem => item !== null),
    succeeded: candidates.length === 0 || enriched.some((result) => result.succeeded),
  };
}

function createRadarItem(
  item: TmdbDiscoverItem,
  mediaType: RadarMediaType,
  channel: RadarChannel,
  streaming: { providers: RadarProvider[]; watchUrl: string | null } | null
): RadarItem {
  const title = decodeHtmlEntities((mediaType === "movie" ? item.title : item.name) ?? "");
  const originalTitle = decodeHtmlEntities((mediaType === "movie" ? item.original_title : item.original_name) ?? "");
  const releaseDate = mediaType === "movie" ? item.release_date : item.first_air_date;

  if (!title || !releaseDate) {
    throw new Error(`TMDb item ${item.id} is missing a title or release date`);
  }

  return {
    id: `${mediaType}-${item.id}-${channel}-${releaseDate}`,
    tmdbId: item.id,
    mediaType,
    channel,
    title,
    originalTitle: originalTitle && originalTitle !== title ? originalTitle : null,
    overview: decodeHtmlEntities(item.overview?.trim() ?? ""),
    posterUrl: item.poster_path ? `${TMDB_IMAGE_BASE}/w342${item.poster_path}` : null,
    releaseDate,
    providers: streaming?.providers ?? [],
    watchUrl: streaming?.watchUrl ?? null,
    csfd: null,
    program: null
  };
}

async function readScheduleCache() {
  try {
    const store = getStore(SCHEDULE_CACHE_STORE, { consistency: "strong" });
    return (await store.get(SCHEDULE_CACHE_KEY, { type: "json" })) as ScheduleResponse | null;
  } catch (error) {
    console.warn("Radar could not read the Fidiko schedule cache", error);
    return null;
  }
}

export function linkProgramMatches(
  items: RadarItem[],
  schedule: ScheduleResponse | null,
  now = getPragueNow(),
) {
  if (!schedule) return items;

  const byCsfdUrl = new Map<string, ScheduleResponse["films"][number]>();
  const byTitle = new Map<string, ScheduleResponse["films"][number][]>();
  for (const film of schedule.films) {
    if (film.csfd?.url) byCsfdUrl.set(normalizeCsfdUrl(film.csfd.url), film);
    const title = normalizeMatchTitle(film.title);
    byTitle.set(title, [...(byTitle.get(title) ?? []), film]);
  }

  return items.map((item) => {
    if (item.channel !== "cinema" || item.mediaType !== "movie") return item;
    const titleCandidates = byTitle.get(normalizeMatchTitle(item.title)) ?? [];
    const film = item.csfd?.url
      ? byCsfdUrl.get(normalizeCsfdUrl(item.csfd.url)) ?? uniqueFilm(titleCandidates.filter((candidate) => !candidate.csfd?.url))
      : uniqueFilm(titleCandidates);
    if (!film) return item;

    const screeningDates = film.screenings.map((screening) => screening.dateISO).sort();
    const upcoming = film.screenings
      .filter((screening) => isUpcomingScreening(screening, now))
      .sort((left, right) => left.dateISO.localeCompare(right.dateISO) || (left.time ?? "99:99").localeCompare(right.time ?? "99:99"));
    if (upcoming.length === 0) return item;

    const csfd = item.csfd ?? createRadarCsfdFromProgramFilm(film);

    return {
      ...item,
      csfd,
      program: {
        filmId: film.id,
        firstScreeningDate: screeningDates[0],
        screeningCount: film.screenings.length,
        upcomingScreeningCount: upcoming.length,
        nextScreening: {
          dateISO: upcoming[0].dateISO,
          time: upcoming[0].time,
        },
      }
    };
  });
}

export const seedItemsWithKnownCsfd = (
  items: RadarItem[],
  previous: RadarSnapshot | null,
  schedule: ScheduleResponse | null,
) => {
  if (!previous && !schedule) return items;

  const previousByIdentity = new Map<string, RadarCsfdMatch>();
  for (const item of previous?.items ?? []) {
    if (!item.csfd) continue;
    previousByIdentity.set(radarIdentityKey(item), item.csfd);
  }

  const programByTitle = new Map<string, ScheduleResponse["films"][number][]>();
  for (const film of schedule?.films ?? []) {
    if (!film.csfd?.url) continue;
    const title = normalizeMatchTitle(film.title);
    programByTitle.set(title, [...(programByTitle.get(title) ?? []), film]);
  }

  return items.map((item) => {
    if (item.csfd) return item;

    const previousMatch = previousByIdentity.get(radarIdentityKey(item));
    if (previousMatch) return { ...item, csfd: previousMatch };

    if (item.channel !== "cinema" || item.mediaType !== "movie") return item;
    const film = uniqueFilm(programByTitle.get(normalizeMatchTitle(item.title)) ?? []);
    const csfd = film ? createRadarCsfdFromProgramFilm(film) : null;
    return csfd ? { ...item, csfd } : item;
  });
};

const radarIdentityKey = (item: Pick<RadarItem, "mediaType" | "channel" | "tmdbId">) => (
  `${item.mediaType}/${item.channel}/${item.tmdbId}`
);

const createRadarCsfdFromProgramFilm = (film: ScheduleResponse["films"][number]): RadarCsfdMatch | null => {
  const { csfd } = film;
  if (!csfd?.url) return null;

  return {
    title: csfd.title,
    rating: csfd.rating,
    ratingCount: csfd.ratingCount,
    url: csfd.url,
    releaseDate: null,
    vodPremieres: [],
  };
};

function uniqueFilm(films: ScheduleResponse["films"]) {
  return films.length === 1 ? films[0] : undefined;
}

function isUpcomingScreening(
  screening: ScheduleResponse["films"][number]["screenings"][number],
  now: { dateISO: string; time: string },
) {
  if (screening.dateISO > now.dateISO) return true;
  if (screening.dateISO < now.dateISO) return false;
  return !screening.time || screening.time >= now.time;
}

function normalizeCsfdUrl(value: string) {
  try {
    return normalizeCsfdPath(new URL(value).pathname);
  } catch {
    return normalizeCsfdPath(value.replace(/[?#].*$/, ""));
  }
}

function normalizeCsfdPath(value: string) {
  const path = value.replace(/\/$/, "");
  const match = path.match(/\/film\/(\d+)/);
  return match ? `/film/${match[1]}` : path;
}

function normalizeMatchTitle(value: string) {
  return normalizeRadarTitle(value);
}

function deduplicateProviders(providers: TmdbProvider[], title?: string) {
  const unique = new Map<number, TmdbProvider>();
  for (const provider of providers) {
    unique.set(provider.provider_id, provider);
  }

  return [...unique.values()]
    .filter((provider) => !isHiddenProvider(provider.provider_name))
    .sort((left, right) => left.display_priority - right.display_priority)
    .map((provider) => ({
      id: provider.provider_id,
      name: provider.provider_name,
      logoUrl: `${TMDB_IMAGE_BASE}/w45${provider.logo_path}`,
      ...getProviderLink(provider.provider_name, title),
    }));
}

function deduplicateItems(items: RadarItem[]) {
  return deduplicateRadarItems(items);
}

function compareItems(left: RadarItem, right: RadarItem) {
  return left.releaseDate.localeCompare(right.releaseDate) || left.title.localeCompare(right.title, "cs-CZ");
}
