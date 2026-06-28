import { afterEach, describe, expect, it, vi } from "vitest";
import { extractFormats, inferScreeningDateISO, normalizeFilmTitle } from "./schedule-scraper";

afterEach(() => vi.useRealTimers());

describe("schedule normalization", () => {
  it.each([
    ["Michael (ČT)", "Michael"],
    ["Scary Movie - Filmový klub", "Scary Movie"],
    ["Po večerce (ČV) - PREMIÉRA", "Po večerce"],
    ["Avatar (ČV) - Dopolední prázdninové promítání", "Avatar"],
    ["Tichá místa (ČT) - TICHÁ STŘEDA", "Tichá místa"]
  ])("cleans %s", (input, expected) => {
    expect(normalizeFilmTitle(input)).toBe(expected);
  });

  it("assigns January dates to the next year when viewed in December", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-20T12:00:00Z"));
    expect(inferScreeningDateISO("5.1.")).toBe("2027-01-05");
  });

  it.each([
    ["Film (OV)", "", ["Originál"]],
    ["Film (ČT)", "", ["Titulky"]],
    ["Film (ČV)", "", ["Dabing"]],
    ["Film (OV)", "2D", ["Originál", "2D"]],
  ])("normalizes language format %s / %s", (title, description, expected) => {
    expect(extractFormats(title, description)).toEqual(expected);
  });
});
