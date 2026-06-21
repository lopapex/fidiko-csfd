import { getStore } from "@netlify/blobs";
import type { RadarMediaType, RadarSnapshot } from "../lib/radar-refresh";

const RADAR_CACHE_STORE = "radar-cache";
const RADAR_CACHE_KEY = "current-v7";
const RADAR_MONTH_CACHE_VERSION = "month-v6";
const RADAR_WEEK_CACHE_VERSION = "week-v6";
const LEGACY_RADAR_CACHE_KEYS = ["current-v6", "current-v5", "current-v4", "current-v3", "current-v2"];
const LEGACY_MONTH_CACHE_VERSIONS = ["month-v5", "month-v4", "month-v3", "month-v2", "month-v1"];
const LEGACY_WEEK_CACHE_VERSIONS = ["week-v5", "week-v4", "week-v3", "week-v2", "week-v1"];
const CACHE_MAX_AGE_SECONDS = 300;

type RadarPeriod = "week" | "month";
type RadarType = "all" | RadarMediaType;
const initializationPromises = new Map<string, Promise<RadarSnapshot>>();

export default async function handler(request: Request) {
  const started = performance.now();

  if (request.method !== "GET") {
    return errorResponse({ error: "Method not allowed" }, 405, { Allow: "GET" });
  }

  const url = new URL(request.url);
  const periodParam = url.searchParams.get("period") ?? "week";
  const period = (periodParam === "upcoming" ? "month" : periodParam) as RadarPeriod;
  const type = (url.searchParams.get("type") ?? "all") as RadarType;
  const requestedMonth = url.searchParams.get("month") ?? getPragueTodayISO().slice(0, 7);
  const currentWeekStart = startOfISOWeek(getPragueTodayISO());
  const requestedWeek = url.searchParams.get("week") ?? currentWeekStart;

  if (period !== "week" && period !== "month") {
    return errorResponse({ error: "Invalid radar period" }, 400);
  }
  if (period === "month" && !validMonth(requestedMonth)) {
    return errorResponse({ error: "Invalid radar month" }, 400);
  }
  if (period === "week" && !validWeek(requestedWeek)) {
    return errorResponse({ error: "Invalid radar week" }, 400);
  }
  if (type !== "all" && type !== "movie" && type !== "series") {
    return errorResponse({ error: "Invalid radar type" }, 400);
  }

  try {
    const weekStart = requestedWeek;
    const weekEnd = addDaysISO(weekStart, 6);
    const start = period === "week" ? weekStart : `${requestedMonth}-01`;
    const end = period === "week" ? weekEnd : addDaysISO(addMonthsISO(start, 1), -1);
    const blobStarted = performance.now();
    const cacheKey = period === "month" ? `${RADAR_MONTH_CACHE_VERSION}/${requestedMonth}` : `${RADAR_WEEK_CACHE_VERSION}/${requestedWeek}`;
    let snapshot = await readRadarCache(cacheKey);
    const blobDuration = performance.now() - blobStarted;
    let initializationDuration = 0;
    let cacheStatus = "hit";

    if (!snapshot) {
      const currentSnapshot = await readRadarCache(RADAR_CACHE_KEY);
      if (currentSnapshot && start >= currentSnapshot.range.start && end <= currentSnapshot.range.end) {
        snapshot = currentSnapshot;
        cacheStatus = "range-hit";
      }
    }

    if (!snapshot) {
      const initializationStarted = performance.now();
      try {
        snapshot = await initializeSnapshot(cacheKey, period, requestedMonth, requestedWeek);
      } catch (error) {
        snapshot = await readLegacySnapshot(period, requestedMonth, requestedWeek, start, end);
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

    const filterStarted = performance.now();
    const items = snapshot.items
      .filter((item) => item.releaseDate >= start && item.releaseDate <= end && (type === "all" || item.mediaType === type))
      .map((item) => ({
        ...item,
        providers: item.providers.filter((provider) => !isHiddenProvider(provider.name))
      }));
    const body = {
      fetchedAt: snapshot.fetchedAt,
      period: {
        mode: period,
        start,
        end,
        month: period === "month" ? requestedMonth : null,
        previousMonth: period === "month" ? addMonthsISO(start, -1).slice(0, 7) : null,
        nextMonth: period === "month" ? addMonthsISO(start, 1).slice(0, 7) : null,
        weekStart: period === "week" ? start : null,
        weekEnd: period === "week" ? end : null,
        previousWeekStart: period === "week" ? addDaysISO(start, -7) : null,
        nextWeekStart: period === "week" ? addDaysISO(start, 7) : null
      },
      items
    };
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

async function readLegacySnapshot(period: RadarPeriod, month: string, week: string, start: string, end: string) {
  const versions = period === "month" ? LEGACY_MONTH_CACHE_VERSIONS : LEGACY_WEEK_CACHE_VERSIONS;
  const value = period === "month" ? month : week;
  for (const version of versions) {
    const periodSnapshot = await readRadarCache(`${version}/${value}`);
    if (periodSnapshot) return periodSnapshot;
  }

  for (const key of LEGACY_RADAR_CACHE_KEYS) {
    const currentSnapshot = await readRadarCache(key);
    if (currentSnapshot && start >= currentSnapshot.range.start && end <= currentSnapshot.range.end) return currentSnapshot;
  }
  return null;
}

async function initializeSnapshot(cacheKey: string, period: RadarPeriod, month: string, week: string) {
  const running = initializationPromises.get(cacheKey);
  if (running) return running;

  const promise = import("../lib/radar-refresh")
    .then((refresh) => period === "month" ? refresh.refreshRadarMonth(month) : refresh.refreshRadarWeek(week))
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

function addMonthsISO(value: string, months: number) {
  const date = parseISODate(value);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function validMonth(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  return year >= 1900 && year <= 2100 && month >= 1 && month <= 12;
}

function validWeek(value: string) {
  try {
    return startOfISOWeek(value) === value;
  } catch {
    return false;
  }
}

function isHiddenProvider(name: string) {
  const normalized = name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  return /\blepsi\s*\.?\s*tv\b/.test(normalized);
}
