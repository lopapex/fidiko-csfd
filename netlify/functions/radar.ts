import { getStore } from "@netlify/blobs";
import type { RadarMediaType, RadarSnapshot } from "../lib/radar-refresh";
import { getProviderLink, isAllowedProvider } from "../lib/radar-providers";

const RADAR_CACHE_STORE = "radar-cache";
const RADAR_CACHE_KEY = "current-v17";
const RADAR_WEEK_CACHE_VERSION = "week-v16";
const LEGACY_RADAR_CACHE_KEYS = ["current-v16", "current-v15", "current-v14", "current-v13", "current-v12", "current-v11", "current-v10", "current-v9", "current-v8", "current-v7", "current-v6", "current-v5", "current-v4", "current-v3", "current-v2"];
const LEGACY_WEEK_CACHE_VERSIONS = ["week-v15", "week-v14", "week-v13", "week-v12", "week-v11", "week-v10", "week-v9", "week-v8", "week-v7", "week-v6", "week-v5", "week-v4", "week-v3", "week-v2", "week-v1"];
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
  const allowRefresh = url.searchParams.get("refresh") === "1";
  const currentWeekStart = startOfISOWeek(getPragueTodayISO());
  const requestedWeek = url.searchParams.get("week") ?? currentWeekStart;

  if (period !== "week" || url.searchParams.has("month")) {
    return errorResponse({ error: "Invalid radar period" }, 400);
  }
  if (!validWeek(requestedWeek)) {
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
    let snapshot = currentSnapshot && start >= currentSnapshot.range.start && end <= currentSnapshot.range.end
      ? currentSnapshot
      : null;
    let staleSnapshot: RadarSnapshot | null = null;
    const blobDuration = performance.now() - blobStarted;
    let initializationDuration = 0;
    let cacheStatus = snapshot ? "range-hit" : "miss";

    if (snapshot && isStaleFutureSnapshot(snapshot, start)) {
      staleSnapshot = snapshot;
      snapshot = null;
      cacheStatus = "stale-range";
    }

    if (!snapshot) {
      snapshot = await readRadarCache(cacheKey);
      if (snapshot) {
        cacheStatus = "hit";
        if (isStaleFutureSnapshot(snapshot, start)) {
          staleSnapshot ??= snapshot;
          snapshot = null;
          cacheStatus = "stale";
        }
      }
    }

    if (!snapshot && (allowRefresh || isInsidePrecomputeWindow(requestedWeek, currentWeekStart))) {
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
        detail: "Radar pro tento tÃ½den zatÃ­m nenÃ­ pÅ™ipravenÃ½."
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
  const store = getStore(RADAR_CACHE_STORE, { consistency: "strong" });
  return (await store.get(key, { type: "json" })) as RadarSnapshot | null;
}

function successResponse(body: unknown, cacheStatus: string, timings: { blob: number; initialize: number; filter: number; total: number }) {
  const serverTiming = [
    `blob;dur=${timings.blob.toFixed(1)}`,
    timings.initialize ? `initialize;dur=${timings.initialize.toFixed(1)}` : null,
    `filter;dur=${timings.filter.toFixed(1)}`,
    `total;dur=${timings.total.toFixed(1)}`
  ].filter(Boolean).join(", ");

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_MAX_AGE_SECONDS}`,
      "netlify-cdn-cache-control": `public, s-maxage=${CACHE_MAX_AGE_SECONDS}`,
      "server-timing": serverTiming,
      "x-radar-cache": cacheStatus
    }
  });
}

function missingResponse(body: unknown, timings: { blob: number; initialize: number; filter: number; total: number }) {
  return new Response(JSON.stringify(body), {
    status: 202,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "server-timing": [
        `blob;dur=${timings.blob.toFixed(1)}`,
        `filter;dur=${timings.filter.toFixed(1)}`,
        `total;dur=${timings.total.toFixed(1)}`
      ].join(", "),
      "x-radar-cache": "missing"
    }
  });
}

function errorResponse(body: unknown, status: number, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders }
  });
}

function getPragueTodayISO() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
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
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function addDaysISO(value: string, days: number) {
  const date = parseISODate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function validWeek(value: string) {
  try {
    return startOfISOWeek(value) === value;
  } catch {
    return false;
  }
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
      providers: item.providers
        .filter((provider) => isAllowedProvider(provider.name))
        .map((provider) => ({
          ...provider,
          ...getProviderLink(provider.name, item.title),
        }))
    }))
    .filter((item) => (
      item.channel !== "streaming"
      || item.providers.length > 0
    )));
}

function deduplicateRadarItems(items: RadarSnapshot["items"]) {
  const byKey = new Map<string, RadarSnapshot["items"][number]>();
  const selected = new Set<RadarSnapshot["items"][number]>();
  for (const item of items) {
    const keys = getRadarDeduplicationKeys(item);
    const existing = keys.map((key) => byKey.get(key)).find(Boolean);
    const selectedItem = existing && !shouldReplaceRadarItem(existing, item) ? existing : item;
    if (existing && selectedItem !== existing) selected.delete(existing);
    selected.add(selectedItem);
    for (const key of keys) byKey.set(key, selectedItem);
  }
  return [...selected.values()];
}

function getRadarDeduplicationKeys(item: RadarSnapshot["items"][number]) {
  const keys = item.csfd?.url ? [`csfd:${normalizeCsfdUrl(item.csfd.url)}`] : [];
  keys.push(...getCinemaTitleDeduplicationKeys(item));
  const streamingKey = getStreamingDeduplicationKey(item);
  if (streamingKey) keys.push(streamingKey);
  keys.push(...getStreamingTitleDeduplicationKeys(item));
  keys.push(`item:${item.id}`);
  return keys;
}

function getCinemaTitleDeduplicationKeys(item: RadarSnapshot["items"][number]) {
  if (item.channel !== "cinema") return [];
  return getComparableTitles(item)
    .map((title) => `cinema-title:${item.mediaType}:${item.releaseDate}:${title}`);
}

function getStreamingDeduplicationKey(item: RadarSnapshot["items"][number]) {
  if (item.channel !== "streaming" || !item.posterUrl || item.providers.length === 0) return null;
  const poster = item.posterUrl.replace(/\/cache\/resized\/w\d+(?:h\d+)?\//, "/cache/resized/");
  const providers = item.providers.map((provider) => provider.id).sort((left, right) => left - right).join(",");
  return `streaming:${item.mediaType}:${item.releaseDate}:${poster}:${providers}`;
}

function getStreamingTitleDeduplicationKeys(item: RadarSnapshot["items"][number]) {
  if (item.channel !== "streaming" || item.providers.length === 0) return [];
  const providers = item.providers.map((provider) => provider.id).sort((left, right) => left - right).join(",");
  return getComparableTitles(item)
    .map((title) => `streaming-title:${item.mediaType}:${item.releaseDate}:${providers}:${title}`);
}

function getComparableTitles(item: Pick<RadarSnapshot["items"][number], "title" | "originalTitle" | "csfd">) {
  return [...new Set([item.title, item.originalTitle, item.csfd?.title]
    .filter((value): value is string => Boolean(value))
    .map(normalizeTitle)
    .filter(Boolean))];
}

function shouldReplaceRadarItem(existing: RadarSnapshot["items"][number], candidate: RadarSnapshot["items"][number]) {
  if (!existing.csfd?.url && Boolean(candidate.csfd?.url)) return true;
  if (existing.csfd?.url && !candidate.csfd?.url) return false;
  if (existing.tmdbId < 0 && candidate.tmdbId > 0) return true;
  if (!hasLocalizedTitle(existing) && hasLocalizedTitle(candidate)) return true;
  if (!existing.posterUrl && Boolean(candidate.posterUrl)) return true;
  return false;
}

function hasLocalizedTitle(item: Pick<RadarSnapshot["items"][number], "title" | "originalTitle">) {
  return Boolean(item.originalTitle && normalizeTitle(item.title) !== normalizeTitle(item.originalTitle));
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

function normalizeTitle(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export default handler;

