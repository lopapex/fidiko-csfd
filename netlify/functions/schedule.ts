import { getStore } from "@netlify/blobs";
import type { ScheduleResponse } from "../lib/schedule-scraper";
import { isMondayISODate } from "../lib/shared/date";
import { createWeeklySchedule } from "../lib/shared/schedule-week";
import { cachedJsonResponse, errorJsonResponse, serverTimingHeader } from "../lib/shared/http";

const SCHEDULE_CACHE_STORE = "schedule-cache";
const SCHEDULE_CACHE_KEY = "current-v2";
const CACHE_MAX_AGE_SECONDS = 300;

type ScheduleMode = "all" | "week";

const handler = async (request: Request) => {
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

function successResponse(
  body: ScheduleResponse,
  cacheStatus: string,
  timings: { blob: number; initialization: number; filter: number; total: number }
) {
  return cachedJsonResponse({
    body,
    cacheStatus: { name: "x-schedule-cache", value: cacheStatus },
    cacheHeader: { maxAgeSeconds: CACHE_MAX_AGE_SECONDS },
    timingHeader: serverTimingHeader({
      blob: timings.blob,
      initialize: timings.initialization,
      filter: timings.filter,
      total: timings.total
    })
  });
}

function errorResponse(body: unknown, status: number, extraHeaders: Record<string, string> = {}) {
  return errorJsonResponse(body, status, extraHeaders);
}

export default handler;

