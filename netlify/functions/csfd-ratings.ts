import { createCsfdRatingsResponse } from "../lib/csfd-ratings";

export default async function handler(request: Request) {
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
}

function jsonResponse(body: unknown, status: number, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}
