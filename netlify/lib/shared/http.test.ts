import { describe, expect, it } from "vitest";
import { cachedJsonResponse, errorJsonResponse, serverTimingHeader } from "./http";

describe("shared HTTP helpers", () => {
  it("creates cached JSON responses with Netlify CDN headers", async () => {
    const response = cachedJsonResponse({
      body: { ok: true },
      cacheStatus: { name: "x-test-cache", value: "hit" },
      cacheHeader: { maxAgeSeconds: 300 },
      timingHeader: "total;dur=1.2",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.get("netlify-cdn-cache-control")).toBe("public, s-maxage=300");
    expect(response.headers.get("x-test-cache")).toBe("hit");
    expect(response.headers.get("server-timing")).toBe("total;dur=1.2");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("creates no-store error responses", () => {
    const response = errorJsonResponse({ error: "Nope" }, 400);

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  it("formats positive timings only", () => {
    expect(serverTimingHeader({ blob: 0.01, initialize: 0, total: 12.345 })).toBe("blob;dur=0.0, total;dur=12.3");
  });
});
