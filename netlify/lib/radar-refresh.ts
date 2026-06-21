import { getStore } from "@netlify/blobs";
import { enrichRadarItemsWithCsfd, type RadarCsfdMatch } from "./radar-csfd";
import type { ScheduleResponse } from "./schedule-scraper";

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
const RADAR_CACHE_STORE = "radar-cache";
const RADAR_CACHE_KEY = "current-v7";
const RADAR_WEEK_CACHE_VERSION = "week-v6";
const SCHEDULE_CACHE_STORE = "schedule-cache";
const SCHEDULE_CACHE_KEY = "current-v2";
const MAX_PAGES = 5;
const PROVIDER_CONCURRENCY = 6;
const REQUEST_TIMEOUT_MS = 12000;
const REQUEST_ATTEMPTS = 3;

export type RadarMediaType = "movie" | "series";
export type RadarChannel = "cinema" | "streaming";

export type RadarProvider = {
  id: number;
  name: string;
  logoUrl: string;
  url: string | null;
};

export type RadarProgramMatch = {
  filmId: string;
  firstScreeningDate: string;
  screeningCount: number;
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
  items: RadarItem[];
};

type TmdbDiscoverItem = {
  id: number;
  title?: string;
  original_title?: string;
  name?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  release_date?: string;
  first_air_date?: string;
};

type TmdbDiscoverResponse = {
  page: number;
  total_pages: number;
  results: TmdbDiscoverItem[];
};

type TmdbTvDetails = TmdbDiscoverItem & {
  seasons?: Array<{
    season_number: number;
    name?: string;
    air_date?: string | null;
    poster_path?: string | null;
  }>;
};

type DiscoverResult = { items: TmdbDiscoverItem[]; succeeded: boolean };

type TmdbProvider = {
  provider_id: number;
  provider_name: string;
  logo_path: string;
  display_priority: number;
};

type TmdbWatchRegion = {
  link?: string;
  flatrate?: TmdbProvider[];
  free?: TmdbProvider[];
  ads?: TmdbProvider[];
};

type TmdbWatchResponse = {
  results?: Record<string, TmdbWatchRegion>;
};

export async function hasRadarCache() {
  const store = getStore(RADAR_CACHE_STORE, { consistency: "strong" });
  return Boolean(await store.get(RADAR_CACHE_KEY));
}

export async function refreshRadarCache(): Promise<RadarSnapshot> {
  const today = getPragueTodayISO();
  const rangeStart = startOfISOWeek(today);
  const rangeEnd = addDaysISO(today, 60);
  const snapshot = await buildRadarSnapshot(rangeStart, rangeEnd);

  const store = getStore(RADAR_CACHE_STORE, { consistency: "strong" });
  await store.setJSON(RADAR_CACHE_KEY, snapshot);
  return snapshot;
}

export async function refreshRadarWeek(weekStart: string): Promise<RadarSnapshot> {
  const snapshot = await buildRadarSnapshot(weekStart, addDaysISO(weekStart, 6));
  const store = getStore(RADAR_CACHE_STORE, { consistency: "strong" });
  await store.setJSON(`${RADAR_WEEK_CACHE_VERSION}/${weekStart}`, snapshot);
  return snapshot;
}

async function buildRadarSnapshot(rangeStart: string, rangeEnd: string) {
  const totalStarted = performance.now();
  const token = process.env.TMDB_API_TOKEN?.trim();
  if (!token) {
    throw new Error("TMDB_API_TOKEN is not configured");
  }

  const discoveryStarted = performance.now();
  const [cinemaMovies, streamingMovies, streamingSeries, schedule] = await Promise.all([
    discoverMovies(token, rangeStart, rangeEnd, "2|3"),
    discoverMovies(token, rangeStart, rangeEnd, "4"),
    discoverSeries(token, rangeStart, rangeEnd),
    readScheduleCache()
  ]);
  const discoveryMs = performance.now() - discoveryStarted;

  if (![cinemaMovies, streamingMovies, streamingSeries].some((result) => result.succeeded)) {
    throw new Error("TMDb discovery is temporarily unavailable");
  }

  const cinemaItems = cinemaMovies.items.map((item) => createRadarItem(item, "movie", "cinema", null));
  const providersStarted = performance.now();
  const movieStreamingItems = await enrichStreamingItems(token, streamingMovies.items, "movie");
  const seriesPremieres = await resolveSeriesPremieres(token, streamingSeries.items.slice(0, 40), rangeStart, rangeEnd);
  const seriesStreamingItems = await enrichStreamingItems(token, seriesPremieres, "series", true);
  const providersMs = performance.now() - providersStarted;
  const csfdStarted = performance.now();
  const enrichedItems = await enrichRadarItemsWithCsfd(
    deduplicateItems([...cinemaItems, ...movieStreamingItems, ...seriesStreamingItems])
  );
  const csfdMs = performance.now() - csfdStarted;
  const linkingStarted = performance.now();
  const items = linkProgramMatches(enrichedItems, schedule).sort(compareItems);
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
    timingsMs: {
      discovery: Math.round(discoveryMs),
      providers: Math.round(providersMs),
      csfd: Math.round(csfdMs),
      linking: Math.round(linkingMs),
      total: Math.round(performance.now() - totalStarted)
    }
  });
  return {
    fetchedAt: new Date().toISOString(),
    range: { start: rangeStart, end: rangeEnd },
    items
  } satisfies RadarSnapshot;
}

async function discoverMovies(token: string, start: string, end: string, releaseType: string): Promise<DiscoverResult> {
  const params = new URLSearchParams({
    language: "cs-CZ",
    region: "CZ",
    sort_by: "release_date.asc",
    "release_date.gte": start,
    "release_date.lte": end,
    with_release_type: releaseType,
    include_adult: "false",
    include_video: "false"
  });

  // TMDb intermittently returns 5xx for release-type and watch-provider filters
  // combined. Streaming candidates are verified against the CZ provider endpoint
  // below, so keeping Discover focused on release dates is both safer and exact.
  try {
    return { items: await fetchDiscoverPages(token, "/discover/movie", params), succeeded: true };
  } catch (error) {
    if (releaseType === "4") {
      console.warn(`TMDb digital movie discovery failed for ${start} to ${end}`, error);
      return { items: [], succeeded: false };
    }

    console.warn(`TMDb regional cinema discovery failed for ${start} to ${end}; using primary releases`, error);
    const fallback = new URLSearchParams({
      language: "cs-CZ",
      sort_by: "primary_release_date.asc",
      "primary_release_date.gte": start,
      "primary_release_date.lte": end,
      include_adult: "false",
      include_video: "false"
    });
    try {
      return { items: await fetchDiscoverPages(token, "/discover/movie", fallback), succeeded: true };
    } catch (fallbackError) {
      console.warn(`TMDb cinema fallback failed for ${start} to ${end}`, fallbackError);
      return { items: [], succeeded: false };
    }
  }
}

async function discoverSeries(token: string, start: string, end: string): Promise<DiscoverResult> {
  const baseParams = new URLSearchParams({
    language: "cs-CZ",
    "air_date.gte": start,
    "air_date.lte": end,
    include_adult: "false",
    include_null_first_air_dates: "false",
    watch_region: "CZ",
    with_watch_monetization_types: "flatrate|free|ads"
  });

  const results = await Promise.allSettled(["popularity.desc", "vote_count.desc"].map(async (sort) => {
    const params = new URLSearchParams(baseParams);
    params.set("sort_by", sort);
    return fetchDiscoverPages(token, "/discover/tv", params, 1);
  }));
  const fulfilled = results.filter((result): result is PromiseFulfilledResult<TmdbDiscoverItem[]> => result.status === "fulfilled");
  if (fulfilled.length === 0) {
    console.warn(`TMDb series discovery failed for ${start} to ${end}`, results.map((result) => result.status === "rejected" ? result.reason : null));
    return { items: [], succeeded: false };
  }

  const unique = new Map<number, TmdbDiscoverItem>();
  for (const result of fulfilled) {
    for (const item of result.value) unique.set(item.id, item);
  }
  return { items: [...unique.values()], succeeded: true };
}

async function resolveSeriesPremieres(token: string, candidates: TmdbDiscoverItem[], start: string, end: string) {
  const resolved = await mapConcurrent(candidates, PROVIDER_CONCURRENCY, async (candidate) => {
    try {
      const details = await tmdbFetch<TmdbTvDetails>(token, `/tv/${candidate.id}?language=cs-CZ`);
      const seasons = (details.seasons ?? []).filter((season) =>
        season.season_number > 0 && Boolean(season.air_date) && season.air_date! >= start && season.air_date! <= end
      );

      return seasons.map((season) => ({
        ...candidate,
        name: `${details.name ?? candidate.name} - Série ${season.season_number}`,
        original_name: `${details.original_name ?? candidate.original_name ?? candidate.name} - Season ${season.season_number}`,
        overview: details.overview ?? candidate.overview,
        poster_path: season.poster_path ?? details.poster_path ?? candidate.poster_path,
        first_air_date: season.air_date ?? undefined
      }));
    } catch (error) {
      console.warn(`TMDb seasons for series ${candidate.id} were skipped`, error);
      return [];
    }
  });

  return resolved.flat();
}

async function fetchDiscoverPages(token: string, path: string, baseParams: URLSearchParams, maxPages = MAX_PAGES) {
  const items: TmdbDiscoverItem[] = [];
  let totalPages = 1;

  for (let page = 1; page <= Math.min(totalPages, maxPages); page += 1) {
    const params = new URLSearchParams(baseParams);
    params.set("page", String(page));
    let response: TmdbDiscoverResponse;
    try {
      response = await tmdbFetch<TmdbDiscoverResponse>(token, `${path}?${params}`);
    } catch (error) {
      if (page === 1) {
        throw error;
      }
      console.warn(`TMDb ${path} page ${page} was skipped after retries`, error);
      break;
    }
    items.push(...response.results);
    totalPages = Math.max(1, response.total_pages);
  }

  return items;
}

async function enrichStreamingItems(token: string, candidates: TmdbDiscoverItem[], mediaType: RadarMediaType, keepWithoutProvider = false) {
  const enriched = await mapConcurrent(candidates, PROVIDER_CONCURRENCY, async (item) => {
    let watch: TmdbWatchResponse;
    try {
      watch = await tmdbFetch<TmdbWatchResponse>(
        token,
        mediaType === "movie" ? `/movie/${item.id}/watch/providers` : `/tv/${item.id}/watch/providers`
      );
    } catch (error) {
      console.warn(`TMDb providers for ${mediaType} ${item.id} were skipped`, error);
      return keepWithoutProvider ? createRadarItem(item, mediaType, "streaming", null) : null;
    }
    const region = watch.results?.CZ;
    if (!region) {
      return keepWithoutProvider ? createRadarItem(item, mediaType, "streaming", null) : null;
    }

    const providers = deduplicateProviders([...(region.flatrate ?? []), ...(region.free ?? []), ...(region.ads ?? [])]);
    if (providers.length === 0) {
      return keepWithoutProvider ? createRadarItem(item, mediaType, "streaming", null) : null;
    }

    return createRadarItem(item, mediaType, "streaming", { providers, watchUrl: region.link ?? null });
  });

  return enriched.filter((item): item is RadarItem => item !== null);
}

function createRadarItem(
  item: TmdbDiscoverItem,
  mediaType: RadarMediaType,
  channel: RadarChannel,
  streaming: { providers: RadarProvider[]; watchUrl: string | null } | null
): RadarItem {
  const title = mediaType === "movie" ? item.title : item.name;
  const originalTitle = mediaType === "movie" ? item.original_title : item.original_name;
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
    overview: item.overview?.trim() ?? "",
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

export function linkProgramMatches(items: RadarItem[], schedule: ScheduleResponse | null) {
  if (!schedule) return items;

  const byCsfdUrl = new Map<string, ScheduleResponse["films"][number]>();
  const byTitle = new Map<string, ScheduleResponse["films"][number]>();
  for (const film of schedule.films) {
    if (film.csfd?.url) byCsfdUrl.set(normalizeCsfdUrl(film.csfd.url), film);
    byTitle.set(normalizeMatchTitle(film.title), film);
  }

  return items.map((item) => {
    if (item.channel !== "cinema" || item.mediaType !== "movie") return item;
    const film = item.csfd?.url
      ? byCsfdUrl.get(normalizeCsfdUrl(item.csfd.url)) ?? byTitle.get(normalizeMatchTitle(item.title))
      : byTitle.get(normalizeMatchTitle(item.title));
    if (!film) return item;
    const screeningDates = film.screenings.map((screening) => screening.dateISO).sort();
    return {
      ...item,
      program: {
        filmId: film.id,
        firstScreeningDate: screeningDates[0],
        screeningCount: film.screenings.length
      }
    };
  });
}

function normalizeCsfdUrl(value: string) {
  try {
    return new URL(value).pathname.replace(/\/$/, "");
  } catch {
    return value.replace(/[?#].*$/, "").replace(/\/$/, "");
  }
}

function normalizeMatchTitle(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function deduplicateProviders(providers: TmdbProvider[]) {
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
      url: getProviderUrl(provider.provider_name)
    }));
}

export function isHiddenProvider(name: string) {
  const normalized = name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  return /\blepsi\s*\.?\s*tv\b/.test(normalized) || /^canal\s*(?:\+|plus)$/.test(normalized.trim());
}

function getProviderUrl(name: string) {
  const normalized = name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const providers: Array<[RegExp, string]> = [
    [/netflix/, "https://www.netflix.com/cz/"],
    [/(?:hbo )?max/, "https://www.max.com/cz/cs"],
    [/disney/, "https://www.disneyplus.com/cs-cz"],
    [/amazon prime|prime video/, "https://www.primevideo.com/"],
    [/apple tv/, "https://tv.apple.com/cz"],
    [/skyshowtime/, "https://www.skyshowtime.com/cz"],
    [/canal\+/, "https://www.canalplus.cz/"],
    [/oneplay|voyo/, "https://www.oneplay.cz/"],
    [/prima/, "https://www.iprima.cz/"],
    [/crunchyroll/, "https://www.crunchyroll.com/"],
    [/mubi/, "https://mubi.com/"],
    [/rakuten/, "https://www.rakuten.tv/cz"],
    [/plex/, "https://watch.plex.tv/"],
    [/youtube/, "https://www.youtube.com/"],
    [/google play/, "https://play.google.com/store/movies"],
    [/microsoft/, "https://www.microsoft.com/cs-cz/store/movies-and-tv"],
    [/dafilms/, "https://dafilms.cz/"],
    [/aerovod/, "https://aerovod.cz/"]
  ];
  return providers.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

function deduplicateItems(items: RadarItem[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function compareItems(left: RadarItem, right: RadarItem) {
  return left.releaseDate.localeCompare(right.releaseDate) || left.title.localeCompare(right.title, "cs-CZ");
}

async function tmdbFetch<T>(token: string, path: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${TMDB_API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: controller.signal
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      const error = new Error(`TMDb ${path} failed with HTTP ${response.status}`);
      if (response.status < 500 || attempt === REQUEST_ATTEMPTS) {
        throw error;
      }
      lastError = error;
    } catch (error) {
      lastError = error;
      if (attempt === REQUEST_ATTEMPTS || (error instanceof Error && /HTTP 4\d\d$/.test(error.message))) {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }

    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
  }

  throw lastError;
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function getPragueTodayISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseISODate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return date;
}

function startOfISOWeek(value: string) {
  const date = parseISODate(value);
  const dayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayOffset);
  return date.toISOString().slice(0, 10);
}

function addDaysISO(value: string, days: number) {
  const date = parseISODate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
