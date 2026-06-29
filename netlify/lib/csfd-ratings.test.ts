import { describe, expect, it } from "vitest";
import { createCsfdRatingsResponse, extractCsfdMovieId } from "./csfd-ratings";

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
});
