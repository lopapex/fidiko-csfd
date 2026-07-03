import { describe, expect, it } from "vitest";
import { buildLookupQueries, buildRootSeriesQueries, createCachedRadarCsfd, createRootCsfdUrl, extractRootCsfdFilmId, formatPrimaryStreamingTitle, isCachedRadarCsfdFresh, isDetailedTitleMatch, normalizeSeasonTitle, selectCandidates, selectCzechVodPremieres, selectRootSeriesCandidate, shouldReuseRadarCsfdMatch, type RadarCsfdMatch } from "../radar-csfd";
import type { RadarItem } from "../radar-refresh";

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

  it("builds root series queries from localized and original season titles", () => {
    expect(buildRootSeriesQueries({
      title: "Medv\u011bd - S\u00e9rie 5",
      originalTitle: "The Bear - Season 5",
    })).toEqual([
      "Medv\u011bd",
      "The Bear",
    ]);
  });

  it("adds an explicit title suffix for primary CSFD streaming seeds", () => {
    expect(formatPrimaryStreamingTitle("X-Men '97", null, "Série 2")).toBe("X-Men '97 - Série 2");
    expect(formatPrimaryStreamingTitle("Avatar - Série 2", null, "Série 2")).toBe("Avatar - Série 2");
  });

  it("normalizes season wording to Czech", () => {
    expect(normalizeSeasonTitle("Lioness - Season 3")).toBe("Lioness - Série 3");
    expect(normalizeSeasonTitle("Lioness - Serie 3")).toBe("Lioness - Série 3");
    expect(normalizeSeasonTitle("Lioness - Série 3")).toBe("Lioness - Série 3");
  });

  it("extracts the root CSFD series URL from a season URL", () => {
    const seasonUrl = "https://www.csfd.cz/film/785031-rod-draka/1552381-serie-3/prehled/";

    expect(extractRootCsfdFilmId(seasonUrl)).toBe(785031);
    expect(createRootCsfdUrl(seasonUrl)).toBe("https://www.csfd.cz/film/785031-rod-draka/prehled/");
  });

  it("does not reuse nested season CSFD matches for series", () => {
    expect(shouldReuseRadarCsfdMatch({
      mediaType: "series",
      csfd: { ...match, url: "https://www.csfd.cz/film/785031-rod-draka/1552381-serie-3/prehled/" },
    })).toBe(false);
    expect(shouldReuseRadarCsfdMatch({
      mediaType: "series",
      csfd: { ...match, url: "https://www.csfd.cz/film/785031-rod-draka/prehled/" },
    })).toBe(true);
    expect(shouldReuseRadarCsfdMatch({
      mediaType: "movie",
      csfd: { ...match, url: "https://www.csfd.cz/film/1-film/2-edice/prehled/" },
    })).toBe(true);
  });

  it("selects the root series candidate instead of season or episode matches", () => {
    const candidates = [
      { id: 1742524, title: "Lioness - Season 3", year: 2026, url: "https://www.csfd.cz/film/1742524/prehled/", type: "season" },
      { id: 1742531, title: "Lioness - Episode 7", year: 2026, url: "https://www.csfd.cz/film/924250-lioness/1742531-episode-7/prehled/", type: "episode" },
      { id: 924250, title: "Lioness", year: 2023, url: "https://www.csfd.cz/film/924250-lioness/prehled/", type: "series" },
    ] as Parameters<typeof selectRootSeriesCandidate>[0];

    expect(selectRootSeriesCandidate(candidates, "Lioness")?.id).toBe(924250);
  });

  it("never accepts standalone episodes as Radar series matches", () => {
    const item = {
      mediaType: "series",
      channel: "streaming",
      title: "Testovac\u00ed epizoda",
      originalTitle: null,
      releaseDate: "2026-07-13",
    } as RadarItem;
    const candidates = [
      { id: 22, title: "Testovac\u00ed epizoda", year: 2026, url: "https://www.csfd.cz/film/1-serial/22-epizoda/prehled/", type: "episode" },
    ] as Parameters<typeof selectCandidates>[0];

    expect(selectCandidates(candidates, item, "Testovac\u00ed epizoda")).toEqual([]);
  });

  it("matches a localized CSFD title through its original alternative title", () => {
    const item = {
      mediaType: "movie",
      channel: "cinema",
      title: "The Death of Robin Hood",
      originalTitle: null,
      releaseDate: "2026-08-13",
    } as RadarItem;
    const candidate = {
      id: 1515925,
      title: "Smrt Robina Hooda",
      year: 2026,
      url: "https://www.csfd.cz/film/1515925-smrt-robina-hooda/prehled/",
      type: "film",
    } as Parameters<typeof selectCandidates>[0][number];
    const details = {
      title: "Smrt Robina Hooda",
      titlesOther: [
        { country: "USA", title: "The Death of Robin Hood" },
      ],
    } as Parameters<typeof isDetailedTitleMatch>[1];

    expect(selectCandidates([candidate], item, "The Death of Robin Hood")).toEqual([candidate]);
    expect(isDetailedTitleMatch(candidate, details, "The Death of Robin Hood")).toBe(true);
  });
});
