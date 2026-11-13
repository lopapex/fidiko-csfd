import { addDaysISO, getPragueTodayISO, startOfISOWeek } from "./date";

/**
 * Pure week slicing of the full schedule. Shared by the `schedule` function
 * (for `?view=week`) and the client, which derives weeks from the cached full
 * schedule so week navigation needs no network round-trip.
 */

type WeekScreening = { dateISO: string; hasSubtitles: boolean; sourceOrder?: number };
type WeekFilm<S extends WeekScreening> = { hasSubtitles: boolean; screenings: S[] };

type WeekSchedule<F> = {
  totals: { films: number; screenings: number; withSubtitles: number };
  period: {
    mode: "all" | "week";
    weekStart: string | null;
    weekEnd: string | null;
    previousWeekStart: string | null;
    nextWeekStart: string | null;
  };
  films: F[];
};

export function createWeeklySchedule<
  S extends WeekScreening,
  F extends WeekFilm<S>,
  T extends WeekSchedule<F>,
>(fullSchedule: T, requestedWeek: string | null, today = getPragueTodayISO()): T {
  const allScreenings = fullSchedule.films.flatMap((film) => film.screenings);
  let weekStart = requestedWeek ?? startOfISOWeek(today);
  let weekEnd = addDaysISO(weekStart, 6);

  if (!requestedWeek && !allScreenings.some((screening) => isDateInRange(screening.dateISO, weekStart, weekEnd))) {
    const firstFutureScreening = allScreenings
      .filter((screening) => screening.dateISO > weekEnd)
      .sort(compareScreeningDates)[0];

    if (firstFutureScreening) {
      weekStart = startOfISOWeek(firstFutureScreening.dateISO);
      weekEnd = addDaysISO(weekStart, 6);
    }
  }

  const films = fullSchedule.films
    .map((film) => {
      const screenings = film.screenings.filter((screening) => isDateInRange(screening.dateISO, weekStart, weekEnd));
      return {
        ...film,
        hasSubtitles: screenings.some((screening) => screening.hasSubtitles),
        screenings,
      };
    })
    .filter((film) => film.screenings.length > 0);

  let previousDate: string | null = null;
  let nextDate: string | null = null;
  for (const screening of allScreenings) {
    if (screening.dateISO < weekStart && (!previousDate || screening.dateISO > previousDate)) {
      previousDate = screening.dateISO;
    }
    if (screening.dateISO > weekEnd && (!nextDate || screening.dateISO < nextDate)) {
      nextDate = screening.dateISO;
    }
  }

  return {
    ...fullSchedule,
    totals: {
      films: films.length,
      screenings: films.reduce((total, film) => total + film.screenings.length, 0),
      withSubtitles: films.filter((film) => film.hasSubtitles).length,
    },
    period: {
      mode: "week",
      weekStart,
      weekEnd,
      previousWeekStart: previousDate ? startOfISOWeek(previousDate) : null,
      nextWeekStart: nextDate ? startOfISOWeek(nextDate) : null,
    },
    films,
  };
}

function isDateInRange(value: string, start: string, end: string) {
  return value >= start && value <= end;
}

function compareScreeningDates(left: WeekScreening, right: WeekScreening) {
  return left.dateISO.localeCompare(right.dateISO) || (left.sourceOrder ?? 0) - (right.sourceOrder ?? 0);
}
