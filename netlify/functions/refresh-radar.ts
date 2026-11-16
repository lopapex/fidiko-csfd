import { hasRadarCache, refreshRadarCache } from "../lib/radar-refresh";
import { isLocalForcedRefresh, isPragueMidnight, jsonResponse, noContentResponse } from "../lib/shared/http";

const handler = async (request: Request) => {
  const isBootstrap = request.headers.get("x-radar-bootstrap") === "1";

  // Locally, `x-refresh-force: 1` rebuilds the radar on request (see refresh-schedule).
  if (!isPragueMidnight() && !isLocalForcedRefresh(request) && (!isBootstrap || (await hasRadarCache()))) {
    console.log("Skipping radar refresh outside Prague midnight");
    return noContentResponse();
  }

  try {
    const radar = await refreshRadarCache();
    console.log(`Radar cache refreshed at ${radar.fetchedAt} with ${radar.items.length} items`);
    return noContentResponse();
  } catch (error) {
    console.error("Radar refresh failed", error instanceof Error ? error.message : error);
    return jsonResponse(
      { error: "Radar refresh failed" },
      error instanceof Error && error.message.includes("TMDB_API_TOKEN") ? 503 : 502,
    );
  }
};

export default handler;
