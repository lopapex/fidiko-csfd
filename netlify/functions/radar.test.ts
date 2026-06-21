import { describe, expect, it } from "vitest";
import handler, { filterRadarItems } from "./radar";
import type { RadarSnapshot } from "../lib/radar-refresh";

const snapshot: RadarSnapshot = {
  fetchedAt: "2026-06-21T00:00:00Z",
  range: { start: "2026-06-15", end: "2026-06-28" },
  items: [
    {
      id: "movie", tmdbId: 1, mediaType: "movie", channel: "cinema", title: "Film",
      originalTitle: null, overview: "", posterUrl: null, releaseDate: "2026-06-21",
      providers: [], watchUrl: null, csfd: null, program: null
    },
    {
      id: "series", tmdbId: 2, mediaType: "series", channel: "streaming", title: "Seriál",
      originalTitle: null, overview: "", posterUrl: null, releaseDate: "2026-06-22",
      providers: [{ id: 1, name: "CANAL+", logoUrl: "", url: null }], watchUrl: null,
      csfd: null, program: null
    }
  ]
};

describe("Radar reader", () => {
  it("filters one inclusive week and media type", () => {
    expect(filterRadarItems(snapshot, "2026-06-15", "2026-06-21", "all").map(item => item.id)).toEqual(["movie"]);
    expect(filterRadarItems(snapshot, "2026-06-15", "2026-06-28", "series")[0].providers).toEqual([]);
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
