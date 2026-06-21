import { afterEach, describe, expect, it, vi } from "vitest";
import { clearApiCache, fetchJson, getCachedApi } from "./api";

afterEach(() => {
  clearApiCache();
  vi.unstubAllGlobals();
});

describe("fetchJson", () => {
  it("caches successful JSON by exact URL", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"value":1}', {
      headers: { "content-type": "application/json" }
    })));

    await fetchJson<{ value: number }>("/api/schedule?view=week&week=2026-06-15");

    expect(getCachedApi<{ value: number }>("/api/schedule?view=week&week=2026-06-15")?.data.value).toBe(1);
    expect(getCachedApi("/api/schedule?view=week&week=2026-06-22")).toBeNull();
  });

  it("explains an HTML response instead of trying to parse it as JSON", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!doctype html>", {
      headers: { "content-type": "text/html" }
    })));

    await expect(fetchJson("/api/schedule")).rejects.toThrow("Netlify Dev");
  });
});
