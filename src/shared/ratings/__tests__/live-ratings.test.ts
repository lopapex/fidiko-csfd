import { describe, expect, it } from "vitest";
import {
  applyLiveRatingsToFilms,
  applyLiveRatingsToRadarItems,
  collectRadarCsfdUrls,
  collectScheduleCsfdUrls,
} from "../live-ratings";
import type { FilmGroup, RadarItem, RadarResponse, ScheduleResponse } from "../../../types";

const csfdUrl = "https://www.csfd.cz/film/1-test/prehled/";

describe("live CSFD rating helpers", () => {
  it("collects unique CSFD URLs from schedule and radar snapshots", () => {
    const schedule = {
      films: [
        { csfd: { url: csfdUrl } },
        { csfd: { url: csfdUrl } },
        { csfd: null },
      ],
    } as ScheduleResponse;
    const radar = {
      items: [
        { csfd: { url: csfdUrl } },
        { csfd: { url: "https://www.csfd.cz/film/2-test/prehled/" } },
      ],
    } as RadarResponse;

    expect(collectScheduleCsfdUrls(schedule)).toEqual([csfdUrl]);
    expect(collectRadarCsfdUrls(radar)).toEqual([
      csfdUrl,
      "https://www.csfd.cz/film/2-test/prehled/",
    ]);
  });

  it("patches only rating fields and leaves snapshot metadata intact", () => {
    const film = {
      title: "Snapshot title",
      posterUrl: "/poster.jpg",
      csfd: {
        title: "Snapshot title",
        rating: 40,
        ratingCount: 10,
        url: csfdUrl,
        poster: "/old.jpg",
      },
    } as FilmGroup;
    const radarItem = {
      title: "Radar title",
      posterUrl: "/radar.jpg",
      providers: [{ name: "Netflix" }],
      csfd: {
        title: "Radar title",
        rating: 55,
        ratingCount: 20,
        url: csfdUrl,
        poster: "/radar-old.jpg",
      },
    } as RadarItem;

    const ratings = { [csfdUrl]: { rating: 75, ratingCount: 1234 } };

    expect(applyLiveRatingsToFilms([film], ratings)[0]).toMatchObject({
      title: "Snapshot title",
      posterUrl: "/poster.jpg",
      csfd: {
        title: "Snapshot title",
        rating: 75,
        ratingCount: 1234,
        url: csfdUrl,
        poster: "/old.jpg",
      },
    });
    expect(applyLiveRatingsToRadarItems([radarItem], ratings)[0]).toMatchObject({
      title: "Radar title",
      posterUrl: "/radar.jpg",
      providers: [{ name: "Netflix" }],
      csfd: {
        rating: 75,
        ratingCount: 1234,
        poster: "/radar-old.jpg",
      },
    });
  });
});

