import type { RadarMediaType, RadarSnapshot } from "../lib/radar-refresh";
import { getRadarStore, RADAR_CACHE_KEY, RADAR_WEEK_CACHE_VERSION } from "../lib/radar-cache";
import { deduplicateRadarItems, normalizeRadarTitle } from "../lib/radar-deduplication";
import { getProviderLink } from "../lib/radar-providers";
import { addDaysISO, getPragueTodayISO, isISOWeekStart, startOfISOWeek } from "../lib/shared/date";
import { cachedJsonResponse, errorJsonResponse, serverTimingHeader } from "../lib/shared/http";

const LEGACY_RADAR_CACHE_KEYS = ["current-v28", "current-v27", "current-v26", "current-v25", "current-v24", "current-v23", "current-v22", "current-v21", "current-v20", "current-v19", "current-v18", "current-v17", "current-v16", "current-v15", "current-v14", "current-v13", "current-v12", "current-v11", "current-v10", "current-v9", "current-v8", "current-v7", "current-v6", "current-v5", "current-v4", "current-v3", "current-v2"];
const LEGACY_WEEK_CACHE_VERSIONS = ["week-v27", "week-v26", "week-v25", "week-v24", "week-v23", "week-v22", "week-v21", "week-v20", "week-v19", "week-v18", "week-v17", "week-v16", "week-v15", "week-v14", "week-v13", "week-v12", "week-v11", "week-v10", "week-v9", "week-v8", "week-v7", "week-v6", "week-v5", "week-v4", "week-v3", "week-v2", "week-v1"];
const CACHE_MAX_AGE_SECONDS = 300;
const FUTURE_SNAPSHOT_MAX_AGE_MS = 86_400_000;
const PRECOMPUTE_PAST_WEEKS = 5;
const PRECOMPUTE_FUTURE_WEEKS = 12;

type RadarType = "all" | RadarMediaType;
const initializationPromises = new Map<string, Promise<RadarSnapshot>>();

const handler = async (request: Request) => {
  const started = performance.now();

  if (request.method !== "GET") {
    return errorResponse({ error: "Method not allowed" }, 405, { Allow: "GET" });
  }

  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? "week";
  const type = (url.searchParams.get("type") ?? "all") as RadarType;
  const currentWeekStart = startOfISOWeek(getPragueTodayISO());
  const requestedWeek = url.searchParams.get("week") ?? currentWeekStart;

  if (period !== "week" || url.searchParams.has("month")) {
    return errorResponse({ error: "Invalid radar period" }, 400);
  }
  if (!isISOWeekStart(requestedWeek)) {
    return errorResponse({ error: "Invalid radar week" }, 400);
  }
  if (type !== "all" && type !== "movie" && type !== "series") {
    return errorResponse({ error: "Invalid radar type" }, 400);
  }

  try {
    const weekStart = requestedWeek;
    const weekEnd = addDaysISO(weekStart, 6);
    const start = weekStart;
    const end = weekEnd;
    const blobStarted = performance.now();
    const cacheKey = `${RADAR_WEEK_CACHE_VERSION}/${requestedWeek}`;
    const currentSnapshot = await readRadarCache(RADAR_CACHE_KEY);
    const rangeSnapshot = currentSnapshot && start >= currentSnapshot.range.start && end <= currentSnapshot.range.end
      ? currentSnapshot
      : null;
    const weekSnapshot = await readRadarCache(cacheKey);
    let snapshot = chooseNewestSnapshot(rangeSnapshot, weekSnapshot);
    let staleSnapshot: RadarSnapshot | null = null;
    const blobDuration = performance.now() - blobStarted;
    let initializationDuration = 0;
    let cacheStatus = snapshot
      ? snapshot === weekSnapshot ? "hit" : "range-hit"
      : "miss";

    if (snapshot && isStaleFutureSnapshot(snapshot, start)) {
      staleSnapshot = snapshot;
      snapshot = null;
      cacheStatus = "stale-range";
    }

    if (!snapshot && isInsidePrecomputeWindow(requestedWeek, currentWeekStart)) {
      const initializationStarted = performance.now();
      try {
        snapshot = await initializeSnapshot(cacheKey, requestedWeek);
      } catch (error) {
        snapshot = staleSnapshot ?? await readLegacySnapshot(requestedWeek, start, end, { allowStaleFuture: true });
        if (snapshot) {
          cacheStatus = "stale-fallback";
        } else if (error instanceof Error && error.message.includes("TMDB_API_TOKEN")) {
          return errorResponse({ error: "Radar is not available", detail: "TMDB_API_TOKEN is not configured" }, 503);
        } else {
          throw error;
        }
      }
      initializationDuration = performance.now() - initializationStarted;
      if (cacheStatus !== "stale-fallback") cacheStatus = "initialized";
    }

    if (!snapshot) {
      snapshot = await readLegacySnapshot(requestedWeek, start, end);
      if (snapshot) {
        cacheStatus = "stale-fallback";
      }
    }

    if (!snapshot) {
      return missingResponse(createBody({
        fetchedAt: new Date().toISOString(),
        start,
        end,
        items: [],
        status: "missing",
        detail: "Radar pro tento týden zatím není připravený."
      }), {
        blob: blobDuration,
        initialize: initializationDuration,
        filter: 0,
        total: performance.now() - started
      });
    }

    const filterStarted = performance.now();
    const items = filterRadarItems(snapshot, start, end, type);
    const body = createBody({ fetchedAt: snapshot.fetchedAt, start, end, items, status: "ready" });
    const filterDuration = performance.now() - filterStarted;

    return successResponse(body, cacheStatus, {
      blob: blobDuration,
      initialize: initializationDuration,
      filter: filterDuration,
      total: performance.now() - started
    });
  } catch (error) {
    console.error("Radar reader failed", error);
    return errorResponse({ error: "Radar could not be loaded", detail: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
}

function createBody({
  fetchedAt,
  start,
  end,
  items,
  status,
  detail,
}: {
  fetchedAt: string;
  start: string;
  end: string;
  items: ReturnType<typeof filterRadarItems>;
  status: "ready" | "missing";
  detail?: string;
}) {
  return {
    fetchedAt,
    status,
    detail,
    period: {
      mode: "week",
      start,
      end,
      weekStart: start,
      weekEnd: end,
      previousWeekStart: addDaysISO(start, -7),
      nextWeekStart: addDaysISO(start, 7)
    },
    items
  };
}

async function readLegacySnapshot(
  week: string,
  start: string,
  end: string,
  { allowStaleFuture = false }: { allowStaleFuture?: boolean } = {},
) {
  for (const version of LEGACY_WEEK_CACHE_VERSIONS) {
    const periodSnapshot = await readRadarCache(`${version}/${week}`);
    if (periodSnapshot && isUsableFallbackSnapshot(periodSnapshot, start, end, allowStaleFuture)) return periodSnapshot;
  }

  for (const key of LEGACY_RADAR_CACHE_KEYS) {
    const currentSnapshot = await readRadarCache(key);
    if (currentSnapshot && isUsableFallbackSnapshot(currentSnapshot, start, end, allowStaleFuture)) return currentSnapshot;
  }
  return null;
}

function isUsableFallbackSnapshot(snapshot: RadarSnapshot, start: string, end: string, allowStaleFuture: boolean) {
  if (start < snapshot.range.start || end > snapshot.range.end) return false;
  return allowStaleFuture || !isStaleFutureSnapshot(snapshot, start);
}

async function initializeSnapshot(cacheKey: string, week: string) {
  const running = initializationPromises.get(cacheKey);
  if (running) return running;

  const promise = import("../lib/radar-refresh")
    .then((refresh) => refresh.refreshRadarWeek(week))
    .finally(() => initializationPromises.delete(cacheKey));
  initializationPromises.set(cacheKey, promise);
  return promise;
}

async function readRadarCache(key: string) {
  const store = getRadarStore();
  return (await store.get(key, { type: "json" })) as RadarSnapshot | null;
}

export function chooseNewestSnapshot(
  rangeSnapshot: RadarSnapshot | null,
  weekSnapshot: RadarSnapshot | null,
) {
  if (!rangeSnapshot) return weekSnapshot;
  if (!weekSnapshot) return rangeSnapshot;
  const rangeTime = Date.parse(rangeSnapshot.fetchedAt);
  const weekTime = Date.parse(weekSnapshot.fetchedAt);
  if (!Number.isFinite(rangeTime)) return weekSnapshot;
  if (!Number.isFinite(weekTime)) return rangeSnapshot;
  return weekTime >= rangeTime ? weekSnapshot : rangeSnapshot;
}

function successResponse(
  body: unknown,
  cacheStatus: string,
  timings: { blob: number; initialize: number; filter: number; total: number }
) {
  return cachedJsonResponse({
    body,
    cacheStatus: { name: "x-radar-cache", value: cacheStatus },
    cacheHeader: { maxAgeSeconds: CACHE_MAX_AGE_SECONDS },
    timingHeader: serverTimingHeader({
      blob: timings.blob,
      initialize: timings.initialize,
      filter: timings.filter,
      total: timings.total
    })
  });
}

function missingResponse(body: unknown, timings: { blob: number; initialize: number; filter: number; total: number }) {
  return new Response(JSON.stringify(body), {
    status: 202,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "server-timing": serverTimingHeader({
        blob: timings.blob,
        initialize: timings.initialize,
        filter: timings.filter,
        total: timings.total
      }),
      "x-radar-cache": "missing"
    }
  });
}

function errorResponse(body: unknown, status: number, extraHeaders: Record<string, string> = {}) {
  return errorJsonResponse(body, status, extraHeaders);
}

function isInsidePrecomputeWindow(weekStart: string, currentWeekStart: string) {
  return weekStart >= addDaysISO(currentWeekStart, -PRECOMPUTE_PAST_WEEKS * 7)
    && weekStart <= addDaysISO(currentWeekStart, PRECOMPUTE_FUTURE_WEEKS * 7);
}

function isStaleFutureSnapshot(snapshot: RadarSnapshot, weekStart: string) {
  if (weekStart <= getPragueTodayISO()) return false;
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  return !Number.isFinite(fetchedAt) || Date.now() - fetchedAt > FUTURE_SNAPSHOT_MAX_AGE_MS;
}

export function filterRadarItems(snapshot: RadarSnapshot, start: string, end: string, type: RadarType) {
  return deduplicateRadarItems(snapshot.items
    .filter((item) => item.releaseDate >= start && item.releaseDate <= end && (type === "all" || item.mediaType === type))
    .map((item) => ({
      ...item,
      title: normalizeSeasonTitle(item.title),
      originalTitle: item.originalTitle ? normalizeSeasonTitle(item.originalTitle) : null,
      csfd: item.csfd
        ? {
          ...item.csfd,
          title: normalizeSeasonTitle(item.csfd.title),
          url: item.mediaType === "series" ? normalizeSeriesCsfdUrl(item.csfd.url) : item.csfd.url,
        }
        : null,
      providers: item.providers
        .map((provider) => ({
          ...provider,
          ...getProviderLink(provider.name, normalizeSeasonTitle(item.title)),
        }))
    }))
    .filter((item) => (
      item.channel !== "streaming"
      || item.providers.length > 0
      || Boolean(item.csfd?.url)
    )));
}

function normalizeSeasonTitle(value: string) {
  return value.replace(/\b(?:season|serie|série)\s+(\d+)\b/giu, "Série $1");
}

function normalizeSeriesCsfdUrl(url: string) {
  const match = url.match(/^(https?:\/\/www\.csfd\.cz\/film\/\d+(?:-[^/]+)?\/)/);
  return match ? `${match[1]}prehled/` : url;
}

function normalizeTitle(value: string) {
  return normalizeRadarTitle(value);
}

export default handler;

