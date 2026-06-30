import { createCsfdRatingsResponse } from "../lib/csfd-ratings";
import { jsonResponse } from "../lib/shared/http";

const handler = async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, { Allow: "POST" });
  }

  try {
    const body = await request.json().catch(() => ({})) as { urls?: unknown };
    const response = await createCsfdRatingsResponse(body.urls);
    return jsonResponse(response, 200);
  } catch (error) {
    console.error("CSFD ratings refresh failed", error);
    return jsonResponse({
      error: "CSFD ratings could not be loaded",
      detail: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
};

export default handler;
