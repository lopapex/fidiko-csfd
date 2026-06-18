import { hasScheduleCache, refreshScheduleCache } from "../lib/schedule-scraper";

export default async function handler(request: Request) {
  const isBootstrap = request.headers.get("x-schedule-bootstrap") === "1";

  if (!isPragueMidnight() && (!isBootstrap || (await hasScheduleCache()))) {
    console.log("Skipping schedule refresh outside Prague midnight");
    return new Response(null, { status: 204 });
  }

  const schedule = await refreshScheduleCache();
  console.log(`Schedule cache refreshed at ${schedule.fetchedAt}`);

  return new Response(null, { status: 204 });
}

function isPragueMidnight() {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    hourCycle: "h23"
  }).format(new Date());

  return hour === "00";
}
