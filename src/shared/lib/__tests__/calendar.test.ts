import { describe, expect, it } from "vitest";
import { buildScreeningIcs, pragueLocalToUtc } from "../calendar";

describe("pragueLocalToUtc", () => {
  it("handles summer and winter time", () => {
    expect(pragueLocalToUtc("2026-06-30", "17:00").toISOString()).toBe("2026-06-30T15:00:00.000Z");
    expect(pragueLocalToUtc("2026-12-01", "20:00").toISOString()).toBe("2026-12-01T19:00:00.000Z");
  });

  it("handles the day of the DST switch", () => {
    expect(pragueLocalToUtc("2026-03-29", "20:00").toISOString()).toBe("2026-03-29T18:00:00.000Z");
    expect(pragueLocalToUtc("2026-10-25", "20:00").toISOString()).toBe("2026-10-25T19:00:00.000Z");
  });
});

describe("buildScreeningIcs", () => {
  const screening = {
    id: "1-po-vecerce-28-06",
    title: "Po večerce; speciál, OV",
    dateISO: "2026-06-28",
    time: "20:00",
    formats: ["Originál", "2D"],
    ticketUrl: "https://example.test/tickets",
    fidikoUrl: "https://example.test/detail",
  };

  it("creates a two-hour UTC event with escaped text", () => {
    const ics = buildScreeningIcs(screening, new Date("2026-06-01T00:00:00Z"))!;

    expect(ics).toContain("DTSTART:20260628T180000Z");
    expect(ics).toContain("DTEND:20260628T200000Z");
    expect(ics).toContain("SUMMARY:Kino: Po večerce\\; speciál\\, OV");
    expect(ics).toContain("URL:https://example.test/tickets");
    expect(ics.split("\r\n").every(line => line.length <= 75)).toBe(true);
  });

  it("returns null for screenings without a time", () => {
    expect(buildScreeningIcs({ ...screening, time: null })).toBeNull();
  });
});
