import { describe, expect, it } from "vitest";
import { getActiveManualRadarOverrides, getRadarPrecomputeWeekStarts, getSeriesDiscoveryDateFilters, getStaleRadarWeekKeys, isHiddenProvider, linkProgramMatches, prepareRadarItemsForSnapshot, resolveSource, seedItemsWithKnownCsfd, type RadarItem, type RadarSnapshot } from "../radar-refresh";
import { decideRadarItemsForSnapshot } from "../radar-decision";
import { getProviderLink, getProviderMetadata, isAllowedProvider } from "../radar-providers";
import type { ScheduleResponse } from "../schedule-scraper";

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

  it("prioritizes episode air-date discovery so continuing seasons are not cut off", () => {
    expect(getSeriesDiscoveryDateFilters()[0]).toEqual(["air_date.gte", "air_date.lte"]);
  });

  it("allows an empty manual override list", () => {
    expect(getActiveManualRadarOverrides([], "2026-07-01")).toEqual([]);
  });

  it("keeps temporary CSFD-backed overrides for titles TMDb discovery can miss", () => {
    const overrides = getActiveManualRadarOverrides(undefined, "2026-07-17");

    expect(overrides).toEqual(expect.arrayContaining([
      expect.objectContaining({ csfdId: 1825747, mediaType: "series" }),
      expect.objectContaining({ csfdId: 1603572, mediaType: "series" }),
      expect.objectContaining({ csfdId: 1744657, mediaType: "series" }),
      expect.objectContaining({
        csfdId: 1863881,
        mediaType: "movie",
        fallbackPremiere: { date: "2026-07-17", provider: "Disney Plus" },
      }),
    ]));
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

  it("adopts the Program CSFD match when Radar lookup missed an unambiguous cinema title", () => {
    const titleItem = { ...baseItem, csfd: null };
    const linked = linkProgramMatches([titleItem], schedule, now)[0];

    expect(linked.program?.filmId).toBe("po-vecerce");
    expect(linked.csfd?.url).toBe(schedule.films[0].csfd?.url);
    expect(linked.csfd?.rating).toBe(schedule.films[0].csfd?.rating);
    expect(linked.csfd?.ratingCount).toBe(schedule.films[0].csfd?.ratingCount);
  });

  it("seeds known CSFD matches from the Program snapshot before Radar lookup", () => {
    const titleItem = { ...baseItem, csfd: null };
    const [seeded] = seedItemsWithKnownCsfd([titleItem], null, schedule);

    expect(seeded.csfd?.url).toBe(schedule.films[0].csfd?.url);
    expect(seeded.csfd?.rating).toBe(schedule.films[0].csfd?.rating);
  });

  it("seeds known CSFD matches from the previous Radar snapshot before Radar lookup", () => {
    const nextItem = { ...baseItem, csfd: null, title: "Other title" };
    const previous: RadarSnapshot = {
      fetchedAt: "2026-06-20T00:00:00Z",
      range: { start: "2026-06-15", end: "2026-06-21" },
      sources: {
        cinemaMovies: { status: "fresh", fetchedAt: "2026-06-20T00:00:00Z" },
        streamingMovies: { status: "fresh", fetchedAt: "2026-06-20T00:00:00Z" },
        streamingSeries: { status: "fresh", fetchedAt: "2026-06-20T00:00:00Z" },
      },
      items: [baseItem],
    };

    const [seeded] = seedItemsWithKnownCsfd([nextItem], previous, null);

    expect(seeded.csfd?.url).toBe(baseItem.csfd?.url);
    expect(seeded.title).toBe("Other title");
  });

  it("does not expose a program link after the final screening", () => {
    expect(linkProgramMatches([baseItem], schedule, { dateISO: "2026-06-21", time: "21:00" })[0].program).toBeNull();
  });

  it.each(["Lepší.TV", "CANAL+", "Canal Plus", "MUBI", "Crunchyroll", "Rakuten TV", "Voyo"])("keeps provider %s visible", provider => {
    expect(isHiddenProvider(provider)).toBe(false);
    expect(isAllowedProvider(provider)).toBe(true);
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

  it.each([
    ["Netflix", "Duna: Část druhá", "https://www.netflix.com/search?q=Duna%3A%20%C4%8C%C3%A1st%20druh%C3%A1"],
    ["Amazon Prime Video", "Duna", "https://www.primevideo.com/search/ref=atv_nb_sr?phrase=Duna"],
    ["Apple TV Plus", "Duna", "https://tv.apple.com/cz/search?term=Duna"],
    ["Prima Plus", "Duna", "https://www.iprima.cz/vyhledavani?query=Duna"],
    ["HBO Max", "Duna: Část druhá", "https://play.hbomax.com/search/result?q=Duna%3A%20%C4%8C%C3%A1st%20druh%C3%A1"],
    ["Oneplay", "Duna: Část druhá", "https://www.oneplay.cz/vyhledat?query=Duna%3A%20%C4%8C%C3%A1st%20druh%C3%A1"],
    ["Netflix", "Avatar: Legenda o Aangovi - Série 2", "https://www.netflix.com/search?q=Avatar%3A%20Legenda%20o%20Aangovi"],
  ])("builds a title search URL for %s", (provider, title, expected) => {
    expect(getProviderLink(provider, title)).toMatchObject({
      url: expected,
      linkType: "search",
    });
  });

  it.each([
    ["Netflix", "https://www.netflix.com/search?q=Duna", "https://www.netflix.com/cz/"],
    ["Amazon Prime Video", "https://www.primevideo.com/search/ref=atv_nb_sr?phrase=Duna", "https://www.primevideo.com/"],
    ["Apple TV Plus", "https://tv.apple.com/cz/search?term=Duna", "https://tv.apple.com/cz"],
    ["Prima Plus", "https://www.iprima.cz/vyhledavani?query=Duna", "https://www.iprima.cz/"],
    ["HBO Max", "https://play.hbomax.com/search/result?q=Duna", "https://play.hbomax.com/"],
    ["Oneplay", "https://www.oneplay.cz/vyhledat?query=Duna", "https://www.oneplay.cz/"],
  ])("uses search for %s on desktop and homepage on mobile", (provider, expectedSearch, expectedMobile) => {
    expect(getProviderLink(provider, "Duna")).toEqual({
      url: expectedSearch,
      linkType: "search",
      mobileUrl: expectedMobile,
      mobileLinkType: "homepage",
    });
  });

  it.each([
    ["Disney Plus", "https://www.disneyplus.com/cs-cz"],
    ["SkyShowtime", "https://www.skyshowtime.com/cz"],
  ])("keeps a stable homepage for %s when no public search route exists", (provider, expected) => {
    expect(getProviderLink(provider, "Duna")).toEqual({
      url: expected,
      linkType: "homepage",
      mobileUrl: expected,
      mobileLinkType: "homepage",
    });
  });

  it.each(["Hulu", "Paramount+", "Peacock", "AMC+", "MGM+", "Starz"])("keeps a disabled icon provider for non-CZ service %s", provider => {
    expect(getProviderMetadata(provider)).toMatchObject({
      id: expect.any(Number),
      logoPath: expect.stringMatching(/^\//),
    });
    expect(getProviderLink(provider, "Duna")).toEqual({
      url: null,
      linkType: undefined,
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
      mobileUrl: "https://www.netflix.com/cz/",
      mobileLinkType: "homepage",
    });
  });

  it("falls back to the provider homepage when the title is empty", () => {
    expect(getProviderLink("Netflix", "  ")).toEqual({
      url: "https://www.netflix.com/cz/",
      linkType: "homepage",
      mobileUrl: "https://www.netflix.com/cz/",
      mobileLinkType: "homepage",
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

  it("uses the CSFD VOD premiere inside the requested week when a series has older premieres too", () => {
    const xmen: RadarItem = {
      ...baseItem,
      id: "series-csfd-1140499-streaming-2024-03-20",
      tmdbId: -1140499,
      mediaType: "series",
      channel: "streaming",
      title: "X-Men '97",
      releaseDate: "2024-03-20",
      providers: [],
      csfd: {
        title: "X-Men '97",
        rating: 84,
        ratingCount: 786,
        url: "https://www.csfd.cz/film/1140499/prehled/",
        releaseDate: "2024-03-20",
        vodPremieres: [
          { date: "2024-03-20", provider: "Disney+" },
          { date: "2026-07-01", provider: "Disney+" },
        ],
      },
    };

    const [item] = prepareRadarItemsForSnapshot([xmen], "2026-06-29", "2026-07-05");

    expect(item.releaseDate).toBe("2026-07-01");
    expect(item.providers.map((provider) => provider.name)).toEqual(["Disney Plus"]);
  });

  it("keeps The Bear season premiere from the CSFD root series VOD date", () => {
    const bear: RadarItem = {
      ...baseItem,
      id: "series-csfd-1184280-streaming-2022-06-23",
      tmdbId: -1184280,
      mediaType: "series",
      channel: "streaming",
      title: "Medvěd - Série 5",
      releaseDate: "2022-06-23",
      providers: [],
      csfd: {
        title: "Medvěd - Série 5",
        rating: 84,
        ratingCount: 4888,
        url: "https://www.csfd.cz/film/1184280/prehled/",
        releaseDate: "2022-06-23",
        vodPremieres: [
          { date: "2022-06-23", provider: "Disney+" },
          { date: "2023-06-22", provider: "Disney+" },
          { date: "2024-06-27", provider: "Disney+" },
          { date: "2025-06-25", provider: "Disney+" },
          { date: "2026-06-25", provider: "Disney+" },
        ],
      },
    };

    const [item] = prepareRadarItemsForSnapshot([bear], "2026-06-22", "2026-06-28");

    expect(item.releaseDate).toBe("2026-06-25");
    expect(item.providers.map((provider) => provider.name)).toEqual(["Disney Plus"]);
  });

  it("publishes Silo season 3 from the Czech CSFD VOD date", () => {
    const silo: RadarItem = {
      ...baseItem,
      id: "series-125988-streaming-2026-07-02",
      tmdbId: 125988,
      mediaType: "series",
      channel: "streaming",
      title: "Silo - Série 3",
      originalTitle: "Silo - Season 3",
      releaseDate: "2026-07-02",
      providers: [],
      csfd: {
        title: "Silo - Série 3",
        rating: 83,
        ratingCount: 6348,
        url: "https://www.csfd.cz/film/1324435/prehled/",
        releaseDate: "2026-07-03",
        vodPremieres: [{ date: "2026-07-03", provider: "Apple TV+" }],
      },
    };

    const decision = decideRadarItemsForSnapshot([silo], "2026-06-29", "2026-07-05");

    expect(decision.items[0]).toMatchObject({
      title: "Silo - Série 3",
      releaseDate: "2026-07-03",
    });
    expect(decision.items[0].providers.map((provider) => provider.name)).toEqual(["Apple TV Plus"]);
    expect(decision.diagnostics.rejectedByReason).toEqual({});
  });

  it("rejects standalone episode CSFD links in the decision engine", () => {
    const episode: RadarItem = {
      ...baseItem,
      mediaType: "series",
      channel: "streaming",
      releaseDate: "2026-07-13",
      csfd: {
        title: "Epizoda 22",
        rating: null,
        ratingCount: null,
        url: "https://www.csfd.cz/film/1-serial/22-episode-22/prehled/",
        releaseDate: "2026-07-13",
        vodPremieres: [{ date: "2026-07-13", provider: "Netflix" }],
      },
    };

    const decision = decideRadarItemsForSnapshot([episode], "2026-07-13", "2026-07-19");

    expect(decision.items).toEqual([]);
    expect(decision.diagnostics.rejectedByReason).toMatchObject({ episode_match: 1 });
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

  it("deduplicates radar items that resolve to the same CSFD URL", () => {
    const first: RadarItem = {
      ...baseItem,
      id: "series-100-streaming-2026-07-01",
      tmdbId: 100,
      mediaType: "series",
      channel: "streaming",
      title: "Várzea: Líheň hvězd",
      originalTitle: "Várzea: Onde Nasce o Futebol",
      releaseDate: "2026-07-01",
      providers: [{ id: 8, name: "Netflix", logoUrl: "", url: "https://www.netflix.com/search?q=Varzea", linkType: "search" }],
      csfd: {
        title: "Várzea: Líheň hvězd",
        rating: null,
        ratingCount: null,
        url: "https://www.csfd.cz/film/1857608/prehled/",
        releaseDate: "2026-07-01",
        vodPremieres: [{ date: "2026-07-01", provider: "Netflix" }],
      },
    };
    const duplicate: RadarItem = {
      ...first,
      id: "series-101-streaming-2026-07-01",
      tmdbId: 101,
      csfd: { ...first.csfd!, url: "https://www.csfd.cz/film/1857608-varzea-lihen-hvezd/prehled/" },
    };

    expect(prepareRadarItemsForSnapshot([first, duplicate], "2026-06-29", "2026-07-05")).toHaveLength(1);
  });

  it("deduplicates a localized streaming item and its original-title duplicate", () => {
    const localized: RadarItem = {
      ...baseItem,
      id: "series-100-streaming-2026-07-01",
      tmdbId: 100,
      mediaType: "series",
      channel: "streaming",
      title: "Várzea: Líheň hvězd",
      originalTitle: "Várzea: Onde Nasce o Futebol",
      posterUrl: "https://image.pmgstatic.com/cache/resized/w360/files/images/film/posters/1/2/poster.jpg",
      releaseDate: "2026-07-01",
      providers: [{ id: 8, name: "Netflix", logoUrl: "", url: "https://www.netflix.com/search?q=Varzea", linkType: "search" }],
      csfd: {
        title: "Várzea: Líheň hvězd",
        rating: null,
        ratingCount: null,
        url: "https://www.csfd.cz/film/1857608/prehled/",
        releaseDate: "2026-07-01",
        vodPremieres: [{ date: "2026-07-01", provider: "Netflix" }],
      },
    };
    const originalOnly: RadarItem = {
      ...localized,
      id: "series-101-streaming-2026-07-01",
      tmdbId: 101,
      title: "Várzea: Onde Nasce o Futebol",
      originalTitle: null,
      posterUrl: "https://image.tmdb.org/t/p/w342/poster.jpg",
      csfd: null,
    };

    const result = prepareRadarItemsForSnapshot([localized, originalOnly], "2026-06-29", "2026-07-05");
    expect(result).toHaveLength(1);
    expect(result[0].csfd?.url).toBe("https://www.csfd.cz/film/1857608/prehled/");
  });

  it("keeps streaming items with an unknown CSFD VOD provider", () => {
    const withUnknownVodProvider: RadarItem = {
      ...baseItem,
      mediaType: "series",
      channel: "streaming",
      releaseDate: "2026-07-01",
      providers: [],
      csfd: {
        title: "Test",
        rating: null,
        ratingCount: null,
        url: "https://www.csfd.cz/film/1/prehled/",
        releaseDate: "2026-07-01",
        vodPremieres: [{ date: "2026-07-01", provider: "Tiny Streamer" }],
      },
    };

    const [item] = prepareRadarItemsForSnapshot([withUnknownVodProvider], "2026-06-29", "2026-07-05");

    expect(item.providers).toEqual([{
      id: expect.any(Number),
      name: "Tiny Streamer",
      logoUrl: null,
      url: null,
      linkType: undefined,
    }]);
    expect(item.providers[0].id).toBeLessThan(0);
  });

  it("adds clickable TMDb CZ providers when CSFD VOD providers are disabled", () => {
    const itemWithDisabledCsfdProvider: RadarItem = {
      ...baseItem,
      mediaType: "series",
      channel: "streaming",
      title: "Test",
      releaseDate: "2026-07-01",
      providers: [{
        id: 337,
        name: "Disney Plus",
        logoUrl: "https://image.tmdb.org/t/p/w45/97yvRBw1GzX7fXprcF80er19ot.jpg",
        url: "https://www.disneyplus.com/cs-cz",
        linkType: "homepage",
        mobileUrl: "https://www.disneyplus.com/cs-cz",
        mobileLinkType: "homepage",
      }],
      csfd: {
        title: "Test",
        rating: null,
        ratingCount: null,
        url: "https://www.csfd.cz/film/1/prehled/",
        releaseDate: "2026-07-01",
        vodPremieres: [{ date: "2026-07-01", provider: "Hulu" }],
      },
    };

    const [item] = prepareRadarItemsForSnapshot([itemWithDisabledCsfdProvider], "2026-06-29", "2026-07-05");

    expect(item.providers.map((provider) => provider.name)).toEqual(["Hulu", "Disney Plus"]);
    expect(item.providers[0]).toMatchObject({ name: "Hulu", url: null });
    expect(item.providers[1]).toMatchObject({ name: "Disney Plus", url: "https://www.disneyplus.com/cs-cz" });
  });

  it("removes streaming items without a CSFD VOD premiere", () => {
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

    expect(prepareRadarItemsForSnapshot([withoutCsfd], "2026-06-29", "2026-07-05")).toEqual([]);
    expect(prepareRadarItemsForSnapshot([withoutVodProvider], "2026-06-29", "2026-07-05")).toEqual([]);
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

  it("publishes Descendants through the narrow Disney TMDb fallback when CSFD has no VOD premiere yet", () => {
    const descendants: RadarItem = {
      ...baseItem,
      mediaType: "movie",
      channel: "streaming",
      title: "Následníci: Zlověstná Říše divů",
      originalTitle: "Descendants: Wicked Wonderland",
      releaseDate: "2026-07-16",
      providers: [],
      csfd: {
        title: "Následníci: Zlověstná Říše divů",
        rating: null,
        ratingCount: null,
        url: "https://www.csfd.cz/film/1863881-naslednici-zlovestna-rise-divu/prehled/",
        releaseDate: null,
        vodPremieres: [],
      },
    };

    const decision = decideRadarItemsForSnapshot([descendants], "2026-07-13", "2026-07-19");

    expect(decision.items[0]).toMatchObject({
      releaseDate: "2026-07-16",
      providers: [expect.objectContaining({ name: "Disney Plus", url: "https://www.disneyplus.com/cs-cz" })],
    });
    expect(decision.diagnostics.rejectedByReason).toEqual({});
  });

  it("publishes Descendants from the temporary CSFD-backed fallback premiere", () => {
    const descendants: RadarItem = {
      ...baseItem,
      tmdbId: -1863881,
      mediaType: "movie",
      channel: "streaming",
      title: "N\u00e1sledn\u00edci: Zlov\u011bstn\u00e1 \u0158\u00ed\u0161e div\u016f",
      originalTitle: null,
      releaseDate: "2026-07-17",
      providers: [],
      csfd: {
        title: "N\u00e1sledn\u00edci: Zlov\u011bstn\u00e1 \u0158\u00ed\u0161e div\u016f",
        rating: null,
        ratingCount: 2,
        url: "https://www.csfd.cz/film/1863881-naslednici-zlovestna-rise-divu/prehled/",
        releaseDate: "2026-07-17",
        vodPremieres: [{ date: "2026-07-17", provider: "Disney Plus" }],
      },
    };

    const decision = decideRadarItemsForSnapshot([descendants], "2026-07-13", "2026-07-19");

    expect(decision.items).toHaveLength(1);
    expect(decision.items[0]).toMatchObject({
      title: "N\u00e1sledn\u00edci: Zlov\u011bstn\u00e1 \u0158\u00ed\u0161e div\u016f",
      releaseDate: "2026-07-17",
      providers: [expect.objectContaining({ name: "Disney Plus", url: "https://www.disneyplus.com/cs-cz" })],
    });
    expect(decision.diagnostics.rejectedByReason).toEqual({});
  });


  it("publishes Camp Rock 3 from a CSFD Disney Channel TV premiere", () => {
    const campRock: RadarItem = {
      ...baseItem,
      mediaType: "movie",
      channel: "streaming",
      title: "Camp Rock 3",
      originalTitle: "Camp Rock 3",
      releaseDate: "2026-08-13",
      providers: [],
      csfd: {
        title: "Camp Rock 3",
        rating: null,
        ratingCount: null,
        url: "https://www.csfd.cz/film/559634-camp-rock-3/prehled/",
        releaseDate: "2026-08-13",
        vodPremieres: [],
      },
    };

    const decision = decideRadarItemsForSnapshot([campRock], "2026-08-10", "2026-08-16");

    expect(decision.items[0]).toMatchObject({
      releaseDate: "2026-08-13",
      providers: [expect.objectContaining({ name: "Disney Plus", url: "https://www.disneyplus.com/cs-cz" })],
    });
    expect(decision.diagnostics.rejectedByReason).toEqual({});
  });

  it("does not publish a non-Disney streaming item without CSFD VOD", () => {
    const nonDisney: RadarItem = {
      ...baseItem,
      mediaType: "movie",
      channel: "streaming",
      title: "Ordinary Streaming Film",
      originalTitle: "Ordinary Streaming Film",
      releaseDate: "2026-07-16",
      providers: [],
      csfd: {
        title: "Ordinary Streaming Film",
        rating: null,
        ratingCount: null,
        url: "https://www.csfd.cz/film/999/prehled/",
        releaseDate: null,
        vodPremieres: [],
      },
    };

    expect(prepareRadarItemsForSnapshot([nonDisney], "2026-07-13", "2026-07-19")).toEqual([]);
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
      "current-v32",
      "week-v31/2026-06-15",
      "week-v31/2026-06-22",
      "week-v30/2026-06-22",
      "week-v15/2026-06-22",
      "week-v14/2026-06-22",
      "week-v13/2026-06-22",
      "week-v12/2026-06-22",
      "week-v11/2026-06-22",
      "week-v10/2026-06-22",
      "week-v9/2026-06-22",
      "week-v31/not-a-date",
      "other/2026-06-22",
    ], new Set(["2026-06-22"]));

    expect(stale).toEqual([
      "week-v31/2026-06-15",
      "week-v30/2026-06-22",
      "week-v15/2026-06-22",
      "week-v14/2026-06-22",
      "week-v13/2026-06-22",
      "week-v12/2026-06-22",
      "week-v11/2026-06-22",
      "week-v10/2026-06-22",
      "week-v9/2026-06-22",
    ]);
  });
});
