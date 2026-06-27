import { afterEach, describe, expect, it, vi } from "vitest";
import { clearApiCache, fetchJson, getApiCacheSize, getCachedApi } from "./api";

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

  it("retries local API requests through Netlify Dev when Vite returns HTML", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("location", { hostname: "localhost", port: "5173" });
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("<!doctype html>", {
        headers: { "content-type": "text/html" }
      }))
      .mockResolvedValueOnce(new Response('{"value":2}', {
        headers: { "content-type": "application/json" }
      }));
    vi.stubGlobal("fetch", fetch);

    const result = await fetchJson<{ value: number }>("/api/schedule");

    expect(result.data.value).toBe(2);
    expect(fetch).toHaveBeenLastCalledWith("http://localhost:8888/api/schedule", { signal: undefined });
  });

  it("keeps only the 24 most recently used URLs", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(
      JSON.stringify({ url }),
      { headers: { "content-type": "application/json" } },
    ))));
    for (let index = 0; index < 25; index += 1) {
      await fetchJson(`/api/radar?week=${index}`);
    }
    expect(getApiCacheSize()).toBe(24);
    expect(getCachedApi("/api/radar?week=0")).toBeNull();
  });

  it("does not keep no-store API responses in memory", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"status":"missing"}', {
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    })));

    await fetchJson("/api/radar?period=week&week=2027-01-04");

    expect(getCachedApi("/api/radar?period=week&week=2027-01-04")).toBeNull();
  });
});
