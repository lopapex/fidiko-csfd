import { describe, expect, it, vi } from "vitest";
import { createCsfdRatingsResponse, extractCsfdMovieId, patchItemsWithFreshCsfdRatings } from "./csfd-ratings";

describe("CSFD live ratings endpoint helpers", () => {
  it("extracts movie IDs only from CSFD film URLs", () => {
    expect(extractCsfdMovieId("https://www.csfd.cz/film/123-title/prehled/?x=1#rating")).toBe(123);
    expect(extractCsfdMovieId("https://www.csfd.cz/film/456/prehled/")).toBe(456);
    expect(extractCsfdMovieId("/film/789-title/prehled/")).toBe(789);
    expect(extractCsfdMovieId("https://www.csfd.cz/film/785031-rod-draka/1552381-serie-3/prehled/")).toBe(1552381);
    expect(extractCsfdMovieId("https://example.com/film/123-title/prehled/")).toBeNull();
    expect(extractCsfdMovieId("https://www.csfd.cz/tvurce/123-name/")).toBeNull();
  });

  it("deduplicates lookups by CSFD ID and keeps response keys by original URL", async () => {
    const calls: number[] = [];
    const url = "https://www.csfd.cz/film/10-test/prehled/";
    const urlWithQuery = "https://www.csfd.cz/film/10-test/prehled/?from=test";

    const response = await createCsfdRatingsResponse([
      url,
      url,
      urlWithQuery,
      "https://example.com/film/11-test/prehled/",
      12,
    ], async id => {
      calls.push(id);
      return { rating: 72, ratingCount: 500 };
    });

    expect(calls).toEqual([10]);
    expect(response.ratings).toEqual({
      [url]: { rating: 72, ratingCount: 500 },
      [urlWithQuery]: { rating: 72, ratingCount: 500 },
    });
    expect(typeof response.fetchedAt).toBe("string");
  });

  it("omits a URL when an individual lookup fails", async () => {
    const response = await createCsfdRatingsResponse([
      "https://www.csfd.cz/film/10-test/prehled/",
    ], async () => null);

    expect(response.ratings).toEqual({});
  });

  it("patches only rating fields and preserves snapshot metadata", async () => {
    const item = {
      title: "Snapshot title",
      posterUrl: "poster.jpg",
      csfd: {
        title: "ČSFD title",
        rating: 40,
        ratingCount: 10,
        url: "https://www.csfd.cz/film/10-test/prehled/",
        poster: "csfd-poster.jpg",
      },
    };

    const [patched] = await patchItemsWithFreshCsfdRatings([item], async () => ({
      rating: 72,
      ratingCount: 500,
    }));

    expect(patched).toEqual({
      ...item,
      csfd: {
        ...item.csfd,
        rating: 72,
        ratingCount: 500,
      },
    });
  });

  it("deduplicates URLs while patching multiple items", async () => {
    const calls: number[] = [];
    const first = {
      id: "first",
      csfd: { rating: 10, ratingCount: 1, url: "https://www.csfd.cz/film/10-test/prehled/" },
    };
    const second = {
      id: "second",
      csfd: { rating: 20, ratingCount: 2, url: "https://www.csfd.cz/film/10-test/prehled/?x=1" },
    };

    const patched = await patchItemsWithFreshCsfdRatings([first, second], async id => {
      calls.push(id);
      return { rating: 80, ratingCount: 900 };
    });

    expect(calls).toEqual([10]);
    expect(patched.map(item => item.csfd)).toEqual([
      { ...first.csfd, rating: 80, ratingCount: 900 },
      { ...second.csfd, rating: 80, ratingCount: 900 },
    ]);
  });

  it("keeps snapshot ratings when the shared refresh fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const item = {
      csfd: { rating: 55, ratingCount: 123, url: "https://www.csfd.cz/film/10-test/prehled/" },
    };

    try {
      await expect(patchItemsWithFreshCsfdRatings([item], async () => {
        throw new Error("CSFD outage");
      })).resolves.toEqual([item]);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });
});
