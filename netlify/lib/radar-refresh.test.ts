import { describe, expect, it } from "vitest";
import { getRadarPrecomputeWeekStarts, getStaleRadarWeekKeys, isHiddenProvider, linkProgramMatches, prepareRadarItemsForSnapshot, resolveSource, type RadarItem, type RadarSnapshot } from "./radar-refresh";
import { getProviderLink, isAllowedProvider } from "./radar-providers";
import type { ScheduleResponse } from "./schedule-scraper";

const baseItem: RadarItem = {
  id: "movie-1-cinema-2026-06-21",
  tmdbId: 1,
  mediaType: "movie",
  channel: "cinema",
  title: "Po večerce",
  originalTitle: null,
  overview: "",
  posterUrl: null,
  releaseDate: "2026-06-21",
  providers: [],
  watchUrl: null,
  csfd: { title: "Po večerce", rating: 70, ratingCount: 10, url: "https://www.csfd.cz/film/1-po-vecerce/prehled/", releaseDate: null, vodPremieres: [] },
  program: null
};

const schedule: ScheduleResponse = {
  fetchedAt: "2026-06-21T00:00:00Z",
  source: "test",
  totals: { films: 1, screenings: 1, withSubtitles: 0 },
  period: { mode: "all", weekStart: null, weekEnd: null, previousWeekStart: null, nextWeekStart: null },
  films: [{
    id: "po-vecerce",
    title: "Po večerce",
    posterUrl: null,
    description: "",
    hasSubtitles: false,
    csfd: { ...baseItem.csfd! },
    screenings: [{
      id: "screening-1", sourceOrder: 1, title: "Po večerce", normalizedTitle: "Po večerce",
      fidikoUrl: "https://fidiko.cz/film", ticketUrl: null, posterUrl: null, dateText: "21.6.",
      dateLabel: "21.6.", dateISO: "2026-06-21", weekday: "neděle", time: "20:00",
      description: "", formats: [], hasSubtitles: false
    }]
  }]
};

describe("Radar integration", () => {
  const now = { dateISO: "2026-06-21", time: "19:00" };

  it("precomputes five weeks back and twelve weeks forward", () => {
    const weeks = getRadarPrecomputeWeekStarts("2026-06-29");

    expect(weeks).toHaveLength(18);
    expect(weeks[0]).toBe("2026-05-25");
    expect(weeks[5]).toBe("2026-06-29");
    expect(weeks[17]).toBe("2026-09-21");
  });

  it("links an exact CSFD URL and calculates future screenings", () => {
    const program = linkProgramMatches([baseItem], schedule, now)[0].program;
    expect(program).toMatchObject({
      filmId: "po-vecerce",
      upcomingScreeningCount: 1,
      nextScreening: { dateISO: "2026-06-21", time: "20:00" },
    });
  });

  it("does not fall back to a title when both CSFD URLs disagree", () => {
    const item = { ...baseItem, csfd: { ...baseItem.csfd!, url: "https://www.csfd.cz/film/999-jiny-film/" } };
    expect(linkProgramMatches([item], schedule, now)[0].program).toBeNull();
  });

  it("uses a title only for one unambiguous candidate with a missing CSFD URL", () => {
    const withoutCsfd = { ...schedule.films[0], csfd: null };
    const titleItem = { ...baseItem, csfd: null };
    expect(linkProgramMatches([titleItem], { ...schedule, films: [withoutCsfd] }, now)[0].program?.filmId).toBe("po-vecerce");
    expect(linkProgramMatches([titleItem], { ...schedule, films: [withoutCsfd, { ...withoutCsfd, id: "duplicate" }] }, now)[0].program).toBeNull();
  });

  it("does not expose a program link after the final screening", () => {
    expect(linkProgramMatches([baseItem], schedule, { dateISO: "2026-06-21", time: "21:00" })[0].program).toBeNull();
  });

  it.each(["Lepší.TV", "CANAL+", "Canal Plus"])("hides provider %s", provider => {
    expect(isHiddenProvider(provider)).toBe(true);
  });

  it.each([
    "Oneplay",
    "Prima Plus",
    "Disney Plus",
    "SkyShowtime",
    "Apple TV Plus",
    "Amazon Prime Video",
    "HBO Max",
    "Netflix",
  ])("allows provider %s", provider => {
    expect(isAllowedProvider(provider)).toBe(true);
  });

  it.each(["MUBI", "Crunchyroll", "Rakuten TV", "Voyo"])("rejects provider %s", provider => {
    expect(isAllowedProvider(provider)).toBe(false);
  });

  it.each([
    ["Netflix", "Duna: Část druhá", "https://www.netflix.com/search?q=Duna%3A%20%C4%8C%C3%A1st%20druh%C3%A1"],
    ["Amazon Prime Video", "Duna", "https://www.primevideo.com/search/ref=atv_nb_sr?phrase=Duna"],
    ["Apple TV Plus", "Duna", "https://tv.apple.com/cz/search?term=Duna"],
    ["Prima Plus", "Duna", "https://www.iprima.cz/vyhledavani?query=Duna"],
    ["HBO Max", "Duna: Část druhá", "https://www.hbomax.com/?q=Duna%3A%20%C4%8C%C3%A1st%20druh%C3%A1"],
    ["Oneplay", "Duna: Část druhá", "https://www.oneplay.cz/vyhledat?query=Duna%3A%20%C4%8C%C3%A1st%20druh%C3%A1"],
    ["Netflix", "Avatar: Legenda o Aangovi - Série 2", "https://www.netflix.com/search?q=Avatar%3A%20Legenda%20o%20Aangovi"],
  ])("builds a title search URL for %s", (provider, title, expected) => {
    expect(getProviderLink(provider, title)).toEqual({
      url: expected,
      linkType: "search",
    });
  });

  it.each([
    ["Disney Plus", "https://www.disneyplus.com/cs-cz"],
    ["SkyShowtime", "https://www.skyshowtime.com/cz"],
  ])("keeps a stable homepage for %s when no public search route exists", (provider, expected) => {
    expect(getProviderLink(provider, "Duna")).toEqual({
      url: expected,
      linkType: "homepage",
    });
  });

  it.each([
    "Avatar - Série 2",
    "Avatar - Serie 2",
    "Avatar - Season 2",
  ])("removes a season suffix from provider search: %s", title => {
    expect(getProviderLink("Netflix", title)).toEqual({
      url: "https://www.netflix.com/search?q=Avatar",
      linkType: "search",
    });
  });

  it("falls back to the provider homepage when the title is empty", () => {
    expect(getProviderLink("Netflix", "  ")).toEqual({
      url: "https://www.netflix.com/cz/",
      linkType: "homepage",
    });
  });

  it("keeps a streaming item in the target week from a CSFD VOD premiere", () => {
    const itemWithCsfdVod: RadarItem = {
      ...baseItem,
      id: "series-10-streaming-2026-06-30",
      tmdbId: 10,
      mediaType: "series",
      channel: "streaming",
      title: "Testovací seriál",
      releaseDate: "2026-06-30",
      providers: [],
      csfd: {
        title: "Testovací seriál",
        rating: null,
        ratingCount: null,
        url: "https://www.csfd.cz/film/10/prehled/",
        releaseDate: "2026-07-01",
        vodPremieres: [{ date: "2026-07-01", provider: "Prime Video" }],
      },
    };

    const [item] = prepareRadarItemsForSnapshot([itemWithCsfdVod], "2026-06-29", "2026-07-05");
    expect(item.releaseDate).toBe("2026-07-01");
    expect(item.providers.map((provider) => provider.name)).toEqual(["Prime Video"]);
    expect(item.providers[0].url).toBe("https://www.primevideo.com/search/ref=atv_nb_sr?phrase=Testovac%C3%AD%20seri%C3%A1l");
  });

  it("prefers CSFD VOD providers over TMDb providers", () => {
    const item: RadarItem = {
      ...baseItem,
      mediaType: "series",
      channel: "streaming",
      releaseDate: "2026-07-01",
      providers: [{ id: 8, name: "Netflix", logoUrl: "", url: "https://www.netflix.com/search?q=Testovac%C3%AD%20seri%C3%A1l", linkType: "search" }],
      csfd: {
        title: "Testovací seriál",
        rating: null,
        ratingCount: null,
        url: "https://www.csfd.cz/film/10/prehled/",
        releaseDate: "2026-07-01",
        vodPremieres: [{ date: "2026-07-01", provider: "Prime Video" }],
      },
    };

    expect(prepareRadarItemsForSnapshot([item], "2026-06-29", "2026-07-05")[0].providers.map((provider) => provider.name)).toEqual(["Prime Video"]);
  });

  it("falls back to TMDb providers when CSFD has no VOD provider", () => {
    const withoutCsfd: RadarItem = {
      ...baseItem,
      mediaType: "series",
      channel: "streaming",
      releaseDate: "2026-07-01",
      providers: [{ id: 8, name: "Netflix", logoUrl: "", url: "https://www.netflix.com/search?q=Test", linkType: "search" }],
      csfd: null,
    };
    const withoutVodProvider: RadarItem = {
      ...withoutCsfd,
      csfd: {
        title: "Test",
        rating: null,
        ratingCount: null,
        url: "https://www.csfd.cz/film/1/prehled/",
        releaseDate: null,
        vodPremieres: [],
      },
    };

    expect(prepareRadarItemsForSnapshot([withoutCsfd], "2026-06-29", "2026-07-05")).toEqual([withoutCsfd]);
    expect(prepareRadarItemsForSnapshot([withoutVodProvider], "2026-06-29", "2026-07-05")[0].providers.map((provider) => provider.name)).toEqual(["Netflix"]);
  });

  it("removes streaming items without CSFD VOD or TMDb providers", () => {
    const item: RadarItem = {
      ...baseItem,
      mediaType: "series",
      channel: "streaming",
      releaseDate: "2026-07-01",
      providers: [],
      csfd: null,
    };

    expect(prepareRadarItemsForSnapshot([item], "2026-06-29", "2026-07-05")).toEqual([]);
  });

  it("moves a streaming item into the week using the CSFD Czech VOD date", () => {
    const shifted: RadarItem = {
      ...baseItem,
      mediaType: "movie",
      channel: "streaming",
      releaseDate: "2026-06-28",
      providers: [],
      csfd: {
        title: "Duna",
        rating: 80,
        ratingCount: 100,
        url: "https://www.csfd.cz/film/2/prehled/",
        releaseDate: "2026-06-29",
        vodPremieres: [{ date: "2026-06-29", provider: "Netflix" }],
      },
    };

    expect(prepareRadarItemsForSnapshot([shifted], "2026-06-29", "2026-07-05")[0].releaseDate).toBe("2026-06-29");
    expect(prepareRadarItemsForSnapshot([shifted], "2026-06-22", "2026-06-28")).toEqual([]);
  });

  it("carries the failed source from the previous compatible snapshot", () => {
    const previous: RadarSnapshot = {
      fetchedAt: "2026-06-20T00:00:00Z",
      range: { start: "2026-06-15", end: "2026-06-28" },
      sources: {
        cinemaMovies: { status: "fresh", fetchedAt: "2026-06-20T00:00:00Z" },
        streamingMovies: { status: "fresh", fetchedAt: "2026-06-20T00:00:00Z" },
        streamingSeries: { status: "fresh", fetchedAt: "2026-06-20T00:00:00Z" },
      },
      items: [baseItem],
    };
    const resolved = resolveSource(
      "cinemaMovies",
      { items: [], succeeded: false },
      previous,
      "2026-06-15",
      "2026-06-21",
      "2026-06-21T00:00:00Z",
    );
    expect(resolved.items).toHaveLength(1);
    expect(resolved.state).toEqual({ status: "carried", fetchedAt: "2026-06-20T00:00:00Z" });
  });

  it("selects only stale weekly radar cache entries for cleanup", () => {
    const stale = getStaleRadarWeekKeys([
      "current-v16",
      "week-v15/2026-06-15",
      "week-v15/2026-06-22",
      "week-v14/2026-06-22",
      "week-v13/2026-06-22",
      "week-v12/2026-06-22",
      "week-v11/2026-06-22",
      "week-v10/2026-06-22",
      "week-v9/2026-06-22",
      "week-v15/not-a-date",
      "other/2026-06-22",
    ], new Set(["2026-06-22"]));

    expect(stale).toEqual([
      "week-v15/2026-06-15",
      "week-v14/2026-06-22",
      "week-v13/2026-06-22",
      "week-v12/2026-06-22",
      "week-v11/2026-06-22",
      "week-v10/2026-06-22",
      "week-v9/2026-06-22",
    ]);
  });
});
