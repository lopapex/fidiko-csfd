import { describe, expect, it } from "vitest";
import type { FilmGroup, Screening } from "../../../../types";
import { getFilmsSortedByFirstScreeningInWeek } from "../ProgramSchedule";

const screening = (dateISO: string, time: string, id: string): Screening => ({
  id,
  title: id,
  fidikoUrl: "https://fidiko.cz/film",
  ticketUrl: null,
  posterUrl: null,
  dateText: dateISO,
  dateLabel: dateISO,
  dateISO,
  weekday: null,
  time,
  description: "",
  formats: [],
  hasSubtitles: false,
});

const film = (id: string, title: string, screenings: Screening[]): FilmGroup => ({
  id,
  title,
  posterUrl: null,
  description: "",
  hasSubtitles: false,
  csfd: null,
  screenings,
});

describe("Program weekly ordering", () => {
  it("orders shared days by the first screening time before falling back to the first weekly screening", () => {
    const days = [
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
    ];
    const poVecerce = film("po-vecerce", "Po vecerce", [
      screening("2026-07-08", "18:00", "po-vecerce-earlier"),
      screening("2026-07-12", "20:00", "po-vecerce-late"),
    ]);
    const minions = film("minions", "Mimoni a monstra", [
      screening("2026-07-12", "17:00", "minions-early"),
    ]);

    expect(getFilmsSortedByFirstScreeningInWeek([poVecerce, minions], days).map(item => item.id)).toEqual([
      "minions",
      "po-vecerce",
    ]);
  });

  it("keeps a later shared day chronological even when one film premiered earlier in the week", () => {
    const days = [
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
    ];
    const denOdhaleni = film("den-odhaleni", "Den odhaleni", [
      screening("2026-07-08", "18:00", "den-odhaleni-earlier"),
      screening("2026-07-12", "20:00", "den-odhaleni-sunday"),
    ]);
    const vaiana = film("vaiana", "Vaiana", [
      screening("2026-07-12", "14:00", "vaiana-sunday"),
    ]);

    expect(getFilmsSortedByFirstScreeningInWeek([denOdhaleni, vaiana], days).map(item => item.id)).toEqual([
      "vaiana",
      "den-odhaleni",
    ]);
  });
});
