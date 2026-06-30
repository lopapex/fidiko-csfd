import { hasScheduleCache, refreshScheduleCache } from "../lib/schedule-scraper";
import { isPragueMidnight, noContentResponse } from "../lib/shared/http";

const handler = async (request: Request) => {
  const isBootstrap = request.headers.get("x-schedule-bootstrap") === "1";

  if (!isPragueMidnight() && (!isBootstrap || (await hasScheduleCache()))) {
    console.log("Skipping schedule refresh outside Prague midnight");
    return noContentResponse();
  }

  const schedule = await refreshScheduleCache();
  console.log(`Schedule cache refreshed at ${schedule.fetchedAt}`);

  return noContentResponse();
};

export default handler;
