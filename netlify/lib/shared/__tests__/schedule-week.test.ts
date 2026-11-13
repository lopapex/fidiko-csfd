import { describe, expect, it } from "vitest";
import { createWeeklySchedule } from "../schedule-week";

const screening = (dateISO: string, hasSubtitles = false, sourceOrder = 0) => ({ dateISO, hasSubtitles, sourceOrder });

const schedule = {
  fetchedAt: "2026-06-28T00:00:00.000Z",
  totals: { films: 2, screenings: 5, withSubtitles: 1 },
  period: { mode: "all" as const, weekStart: null, weekEnd: null, previousWeekStart: null, nextWeekStart: null },
  films: [
    { id: "a", hasSubtitles: true, screenings: [screening("2026-06-16"), screening("2026-06-30", true), screening("2026-07-20")] },
    { id: "b", hasSubtitles: false, screenings: [screening("2026-07-01"), screening("2026-07-05")] },
  ],
};

describe("createWeeklySchedule", () => {
  it("slices the requested week and links neighbouring weeks with screenings", () => {
    const week = createWeeklySchedule(schedule, "2026-06-29", "2026-06-29");

    expect(week.period).toEqual({
      mode: "week",
      weekStart: "2026-06-29",
      weekEnd: "2026-07-05",
      previousWeekStart: "2026-06-15",
      nextWeekStart: "2026-07-20",
    });
    expect(week.films.map((film) => [film.id, film.screenings.length, film.hasSubtitles])).toEqual([
      ["a", 1, true],
      ["b", 2, false],
    ]);
    expect(week.totals).toEqual({ films: 2, screenings: 3, withSubtitles: 1 });
  });

  it("jumps to the first future week with screenings when the current week is empty", () => {
    const week = createWeeklySchedule(schedule, null, "2026-06-24");

    expect(week.period.weekStart).toBe("2026-06-29");
  });

  it("keeps an explicitly requested empty week", () => {
    const week = createWeeklySchedule(schedule, "2026-07-06", "2026-06-24");

    expect(week.films).toEqual([]);
    expect(week.period.previousWeekStart).toBe("2026-06-29");
    expect(week.period.nextWeekStart).toBe("2026-07-20");
  });
});
