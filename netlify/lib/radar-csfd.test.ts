import { describe, expect, it } from "vitest";
import { buildLookupQueries, createCachedRadarCsfd, isCachedRadarCsfdFresh, selectCzechVodPremieres, type RadarCsfdMatch } from "./radar-csfd";

const match: RadarCsfdMatch = {
  title: "Film",
  rating: 70,
  ratingCount: 100,
  url: "https://www.csfd.cz/film/1-film/",
  releaseDate: null,
  vodPremieres: [],
};

describe("Radar CSFD cache", () => {
  const checkedAt = "2026-06-21T00:00:00.000Z";
  const now = Date.parse(checkedAt);

  it("keeps matches for seven days and negative results for one day", () => {
    const matched = createCachedRadarCsfd({ status: "matched", match }, checkedAt)!;
    const missing = createCachedRadarCsfd({ status: "not_found" }, checkedAt)!;
    expect(isCachedRadarCsfdFresh(matched, now + 7 * 86_400_000)).toBe(true);
    expect(isCachedRadarCsfdFresh(matched, now + 7 * 86_400_000 + 1)).toBe(false);
    expect(isCachedRadarCsfdFresh(missing, now + 86_400_000)).toBe(true);
    expect(isCachedRadarCsfdFresh(missing, now + 86_400_001)).toBe(false);
  });

  it("never creates a cache entry for a timeout or lookup error", () => {
    expect(createCachedRadarCsfd({ status: "error" }, checkedAt)).toBeNull();
  });

  it("extracts only whitelisted VOD premieres and normalizes dates", () => {
    expect(selectCzechVodPremieres([
      { format: "Na VOD", date: "01.07.2026", company: "Prime Video" },
      { format: "Na VOD", date: "2026-07-02", company: "MUBI" },
      { format: "V kinech", date: "2026-07-03", company: "Netflix" },
    ], { channel: "streaming" })).toEqual([
      { date: "2026-07-01", provider: "Prime Video" },
    ]);
  });

  it("tries an exact season title before the stripped series title", () => {
    expect(buildLookupQueries({
      mediaType: "series",
      title: "Testovací titul - Série 3",
      originalTitle: "Test Title - Season 3",
    })).toEqual([
      "Testovací titul - Série 3",
      "Test Title - Season 3",
      "Testovací titul",
      "Test Title",
    ]);
  });
});
