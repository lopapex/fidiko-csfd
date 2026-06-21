import { hasRadarCache, refreshRadarCache } from "../lib/radar-refresh";

export default async function handler(request: Request) {
  const isBootstrap = request.headers.get("x-radar-bootstrap") === "1";

  if (!isPragueMidnight() && (!isBootstrap || (await hasRadarCache()))) {
    console.log("Skipping radar refresh outside Prague midnight");
    return new Response(null, { status: 204 });
  }

  try {
    const radar = await refreshRadarCache();
    console.log(`Radar cache refreshed at ${radar.fetchedAt} with ${radar.items.length} items`);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Radar refresh failed", error instanceof Error ? error.message : error);
    return new Response(JSON.stringify({ error: "Radar refresh failed" }), {
      status: error instanceof Error && error.message.includes("TMDB_API_TOKEN") ? 503 : 502,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }
}

function isPragueMidnight() {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    hourCycle: "h23"
  }).format(new Date());
  return hour === "00";
}
