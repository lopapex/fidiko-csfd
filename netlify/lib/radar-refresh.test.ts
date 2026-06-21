import { describe, expect, it } from "vitest";
import { isHiddenProvider, linkProgramMatches, type RadarItem } from "./radar-refresh";
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
  csfd: { title: "Po večerce", rating: 70, ratingCount: 10, url: "https://www.csfd.cz/film/1-po-vecerce/prehled/", poster: null },
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
  it("links only an exact CSFD or normalized-title match", () => {
    expect(linkProgramMatches([baseItem], schedule)[0].program?.filmId).toBe("po-vecerce");
    expect(linkProgramMatches([{ ...baseItem, title: "Po večerce 2", csfd: null }], schedule)[0].program).toBeNull();
  });

  it.each(["Lepší.TV", "CANAL+", "Canal Plus"])("hides provider %s", provider => {
    expect(isHiddenProvider(provider)).toBe(true);
  });
});
