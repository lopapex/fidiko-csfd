import { hasScheduleCache, refreshScheduleCache, repairScheduleCsfd } from "../lib/schedule-scraper";
import { isLocalForcedRefresh, isPragueMidnight, noContentResponse } from "../lib/shared/http";

/**
 * Runs every hour. At Prague midnight (or when there is no cache yet) the whole
 * program is scraped again; in between it only asks ČSFD once more for films
 * that still have no match.
 *
 * Local development never reaches midnight on its own: `netlify dev` does not run
 * schedules. There, `curl -H "x-refresh-force: 1" localhost:8888/.netlify/functions/refresh-schedule`
 * scrapes the program right now.
 */
const handler = async (request: Request) => {
  const isBootstrap = request.headers.get("x-schedule-bootstrap") === "1";
  const isFullRefresh = isPragueMidnight() || isLocalForcedRefresh(request) || (isBootstrap && !(await hasScheduleCache()));

  if (!isFullRefresh) {
    if (!isBootstrap) {
      try {
        const repaired = await repairScheduleCsfd();
        if (repaired > 0) console.log(`Schedule CSFD repair matched ${repaired} more films`);
      } catch (error) {
        console.warn("Schedule CSFD repair failed", error instanceof Error ? error.message : error);
      }
    }
    return noContentResponse();
  }

  const schedule = await refreshScheduleCache();
  console.log(`Schedule cache refreshed at ${schedule.fetchedAt}`);

  return noContentResponse();
};

export default handler;
