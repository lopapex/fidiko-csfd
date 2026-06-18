import { getStore } from "@netlify/blobs";
import type { RawScreening, ScheduleResponse } from "../lib/schedule-scraper";

const SCHEDULE_CACHE_STORE = "schedule-cache";
const SCHEDULE_CACHE_KEY = "current-v2";
const CACHE_MAX_AGE_SECONDS = 300;

type ScheduleMode = "all" | "week";

export default async function handler(request: Request) {
  const requestStarted = performance.now();

  if (request.method !== "GET") {
    return errorResponse({ error: "Method not allowed" }, 405, { Allow: "GET" });
  }

  try {
    const url = new URL(request.url);
    const view = url.searchParams.get("view");

    if (view !== null && view !== "all" && view !== "week") {
      return errorResponse({ error: "Invalid schedule view" }, 400);
    }

    const mode: ScheduleMode = view === "week" ? "week" : "all";
    const requestedWeek = url.searchParams.get("week");

    if (mode === "week" && requestedWeek && !isMondayISODate(requestedWeek)) {
      return errorResponse({ error: "Week must be a Monday in YYYY-MM-DD format" }, 400);
    }

    const blobStarted = performance.now();
    let fullSchedule = await readScheduleCache();
    const blobDuration = performance.now() - blobStarted;
    let initializationDuration = 0;
    let cacheStatus = "hit";

    if (!fullSchedule) {
      const initializationStarted = performance.now();
      const refreshResponse = await fetch(new URL("/.netlify/functions/refresh-schedule", request.url), {
        headers: { "x-schedule-bootstrap": "1" }
      });

      if (!refreshResponse.ok) {
        throw new Error(`Schedule initialization failed with HTTP ${refreshResponse.status}`);
      }

      fullSchedule = await readScheduleCache();
      if (!fullSchedule) {
        throw new Error("Schedule initialization completed without cache data");
      }

      initializationDuration = performance.now() - initializationStarted;
      cacheStatus = "initialized";
    }

    const filterStarted = performance.now();
    const schedule = mode === "week" ? createWeeklySchedule(fullSchedule, requestedWeek) : fullSchedule;
    const filterDuration = performance.now() - filterStarted;

    return successResponse(schedule, cacheStatus, {
      blob: blobDuration,
      initialization: initializationDuration,
      filter: filterDuration,
      total: performance.now() - requestStarted
    });
  } catch (error) {
    console.error(error);

    return errorResponse(
      {
        error: "Schedule could not be loaded",
        detail: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
}

async function readScheduleCache() {
  const store = getStore(SCHEDULE_CACHE_STORE, { consistency: "strong" });
  return (await store.get(SCHEDULE_CACHE_KEY, { type: "json" })) as ScheduleResponse | null;
}

function createWeeklySchedule(fullSchedule: ScheduleResponse, requestedWeek: string | null): ScheduleResponse {
  const allScreenings = fullSchedule.films.flatMap((film) => film.screenings);
  let weekStart = requestedWeek ?? startOfISOWeek(getPragueTodayISO());
  let weekEnd = addDaysISO(weekStart, 6);

  if (!requestedWeek && !allScreenings.some((screening) => isDateInRange(screening.dateISO, weekStart, weekEnd))) {
    const firstFutureScreening = allScreenings
      .filter((screening) => screening.dateISO > weekEnd)
      .sort(compareScreeningDates)[0];

    if (firstFutureScreening) {
      weekStart = startOfISOWeek(firstFutureScreening.dateISO);
      weekEnd = addDaysISO(weekStart, 6);
    }
  }

  const films = fullSchedule.films
    .map((film) => {
      const screenings = film.screenings.filter((screening) => isDateInRange(screening.dateISO, weekStart, weekEnd));
      return {
        ...film,
        hasSubtitles: screenings.some((screening) => screening.hasSubtitles),
        screenings
      };
    })
    .filter((film) => film.screenings.length > 0);
  const previousDate = allScreenings
    .filter((screening) => screening.dateISO < weekStart)
    .sort(compareScreeningDates)
    .at(-1)?.dateISO;
  const nextDate = allScreenings
    .filter((screening) => screening.dateISO > weekEnd)
    .sort(compareScreeningDates)[0]?.dateISO;

  return {
    ...fullSchedule,
    totals: {
      films: films.length,
      screenings: films.reduce((total, film) => total + film.screenings.length, 0),
      withSubtitles: films.filter((film) => film.hasSubtitles).length
    },
    period: {
      mode: "week",
      weekStart,
      weekEnd,
      previousWeekStart: previousDate ? startOfISOWeek(previousDate) : null,
      nextWeekStart: nextDate ? startOfISOWeek(nextDate) : null
    },
    films
  };
}

function successResponse(
  body: ScheduleResponse,
  cacheStatus: string,
  timings: { blob: number; initialization: number; filter: number; total: number }
) {
  const serverTiming = [
    `blob;dur=${timings.blob.toFixed(1)}`,
    timings.initialization > 0 ? `initialize;dur=${timings.initialization.toFixed(1)}` : null,
    `filter;dur=${timings.filter.toFixed(1)}`,
    `total;dur=${timings.total.toFixed(1)}`
  ]
    .filter(Boolean)
    .join(", ");

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_MAX_AGE_SECONDS}`,
      "netlify-cdn-cache-control": `public, s-maxage=${CACHE_MAX_AGE_SECONDS}`,
      "server-timing": serverTiming,
      "x-schedule-cache": cacheStatus
    }
  });
}

function errorResponse(body: unknown, status: number, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders
    }
  });
}

function isDateInRange(value: string, start: string, end: string) {
  return value >= start && value <= end;
}

function compareScreeningDates(left: RawScreening, right: RawScreening) {
  return left.dateISO.localeCompare(right.dateISO) || left.sourceOrder - right.sourceOrder;
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function isMondayISODate(value: string) {
  return parseISODate(value)?.getUTCDay() === 1;
}

function startOfISOWeek(value: string) {
  const date = parseISODate(value);
  if (!date) {
    throw new Error(`Invalid ISO date: ${value}`);
  }

  const dayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayOffset);
  return date.toISOString().slice(0, 10);
}

function addDaysISO(value: string, days: number) {
  const date = parseISODate(value);
  if (!date) {
    throw new Error(`Invalid ISO date: ${value}`);
  }

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
