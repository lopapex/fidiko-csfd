import { describe, expect, it } from "vitest";
import handler, { chooseNewestSnapshot, filterRadarItems } from "../radar";
import type { RadarSnapshot } from "../../lib/radar-refresh";

const snapshot: RadarSnapshot = {
  fetchedAt: "2026-06-21T00:00:00Z",
  range: { start: "2026-06-15", end: "2026-06-28" },
  sources: {
    cinemaMovies: { status: "fresh", fetchedAt: "2026-06-21T00:00:00Z" },
    streamingMovies: { status: "fresh", fetchedAt: "2026-06-21T00:00:00Z" },
    streamingSeries: { status: "fresh", fetchedAt: "2026-06-21T00:00:00Z" },
  },
  items: [
    {
      id: "movie", tmdbId: 1, mediaType: "movie", channel: "cinema", title: "Film",
      originalTitle: null, overview: "", posterUrl: null, releaseDate: "2026-06-21",
      providers: [], watchUrl: null, csfd: null, program: null
    },
    {
      id: "series", tmdbId: 2, mediaType: "series", channel: "streaming", title: "Seriál",
      originalTitle: null, overview: "", posterUrl: null, releaseDate: "2026-06-22",
      providers: [
        { id: 1, name: "CANAL+", logoUrl: "", url: null },
        { id: 2, name: "Netflix", logoUrl: "", url: "https://www.netflix.com/cz/" },
      ], watchUrl: null,
      csfd: {
        title: "Seriál",
        rating: null,
        ratingCount: null,
        url: "https://www.csfd.cz/film/1/prehled/",
        releaseDate: "2026-06-22",
        vodPremieres: [{ date: "2026-06-22", provider: "Netflix" }],
      },
      program: null
    }
  ]
};

describe("Radar reader", () => {
  it("filters one inclusive week and media type", () => {
    expect(filterRadarItems(snapshot, "2026-06-15", "2026-06-21", "all").map(item => item.id)).toEqual(["movie"]);
    const providers = filterRadarItems(snapshot, "2026-06-15", "2026-06-28", "series")[0].providers;
    expect(providers.map(provider => provider.name)).toEqual(["Netflix"]);
    expect(providers[0].url).toBe("https://www.netflix.com/search?q=Seri%C3%A1l");
    expect(providers[0].linkType).toBe("search");
  });

  it("normalizes season wording from older snapshots", () => {
    const seasonSnapshot: RadarSnapshot = {
      ...snapshot,
      items: [{
        ...snapshot.items[1],
        title: "Lioness - Season 3",
        originalTitle: "Lioness - Season 3",
        csfd: {
          ...snapshot.items[1].csfd!,
          title: "Lioness - Season 3",
          url: "https://www.csfd.cz/film/785031-rod-draka/1552381-serie-3/prehled/",
        },
      }],
    };
    const [item] = filterRadarItems(seasonSnapshot, "2026-06-15", "2026-06-28", "series");

    expect(item.title).toBe("Lioness - Série 3");
    expect(item.originalTitle).toBe("Lioness - Série 3");
    expect(item.csfd?.title).toBe("Lioness - Série 3");
    expect(item.csfd?.url).toBe("https://www.csfd.cz/film/785031-rod-draka/prehled/");
    expect(item.providers[0].url).toBe("https://www.netflix.com/search?q=Lioness");
  });

  it("normalizes nested CSFD season links to the root series page", () => {
    const seasonSnapshot: RadarSnapshot = {
      ...snapshot,
      items: [
        {
          ...snapshot.items[1],
          id: "rod-draka",
          title: "Rod draka - Série 3",
          posterUrl: "https://image.test/rod-draka.jpg",
          csfd: {
            ...snapshot.items[1].csfd!,
            title: "Rod draka - Série 3",
            url: "https://www.csfd.cz/film/785031-rod-draka/1552381-serie-3/prehled/",
          },
        },
        {
          ...snapshot.items[1],
          id: "avatar",
          title: "Avatar: Legenda o Aangovi - Série 2",
          posterUrl: "https://image.test/avatar.jpg",
          csfd: {
            ...snapshot.items[1].csfd!,
            title: "Avatar: Legenda o Aangovi - Série 2",
            url: "https://www.csfd.cz/film/1377663-avatar-legenda-o-aangovi/1494570-serie-2/prehled/",
          },
        },
      ],
    };

    expect(filterRadarItems(seasonSnapshot, "2026-06-15", "2026-06-28", "series").map(item => item.csfd?.url)).toEqual([
      "https://www.csfd.cz/film/785031-rod-draka/prehled/",
      "https://www.csfd.cz/film/1377663-avatar-legenda-o-aangovi/prehled/",
    ]);
  });

  it("prefers a newer week snapshot over an older range snapshot", () => {
    const newerWeek = {
      ...snapshot,
      fetchedAt: "2026-06-22T00:00:00Z",
      range: { start: "2026-06-15", end: "2026-06-21" },
    };

    expect(chooseNewestSnapshot(snapshot, newerWeek)).toBe(newerWeek);
    expect(chooseNewestSnapshot(newerWeek, snapshot)).toBe(newerWeek);
  });

  it("removes a streaming series without whitelisted providers even when CSFD fallback exists", () => {
    const hiddenOnly = {
      ...snapshot,
      items: [{
        ...snapshot.items[1],
        providers: [{ id: 1, name: "MUBI", logoUrl: "", url: null }],
        csfd: { title: "Seriál", rating: null, ratingCount: null, url: "https://www.csfd.cz/film/1/prehled/", releaseDate: "2026-06-22", vodPremieres: [{ date: "2026-06-22", provider: "Netflix" }] }
      }],
    };
    const items = filterRadarItems(hiddenOnly, "2026-06-15", "2026-06-28", "all");
    expect(items).toEqual([]);
  });

  it("removes a streaming series without providers or CSFD fallback", () => {
    const hiddenOnly = {
      ...snapshot,
      items: [{ ...snapshot.items[1], providers: [{ id: 1, name: "MUBI", logoUrl: "", url: null }] }],
    };
    expect(filterRadarItems(hiddenOnly, "2026-06-15", "2026-06-28", "all")).toEqual([]);
  });

  it("removes a streaming movie when no whitelisted provider remains", () => {
    const hiddenOnly = {
      ...snapshot,
      items: [{
        ...snapshot.items[1],
        id: "streaming-movie",
        mediaType: "movie" as const,
        providers: [{ id: 1, name: "MUBI", logoUrl: "", url: null }]
      }],
    };
    expect(filterRadarItems(hiddenOnly, "2026-06-15", "2026-06-28", "all")).toEqual([]);
  });

  it.each([
    "https://example.test/api/radar?period=month",
    "https://example.test/api/radar?period=upcoming",
    "https://example.test/api/radar?period=week&month=2026-06"
  ])("rejects removed month variants", async url => {
    const response = await handler(new Request(url));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
