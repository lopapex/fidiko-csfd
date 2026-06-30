import { describe, expect, it } from "vitest";
import { addDaysISO, getPragueNow, getPragueTodayISO, isISOWeekStart, isMondayISODate, parseISODate, startOfISOWeek } from "../date";

describe("shared date helpers", () => {
  it("validates ISO dates and Mondays", () => {
    expect(parseISODate("2026-06-29")?.toISOString().slice(0, 10)).toBe("2026-06-29");
    expect(parseISODate("2026-02-31")).toBeNull();
    expect(isMondayISODate("2026-06-29")).toBe(true);
    expect(isMondayISODate("2026-06-30")).toBe(false);
    expect(isISOWeekStart("2026-06-29")).toBe(true);
    expect(isISOWeekStart("2026-06-30")).toBe(false);
  });

  it("calculates ISO weeks across a year boundary", () => {
    expect(startOfISOWeek("2027-01-01")).toBe("2026-12-28");
    expect(addDaysISO("2026-12-28", 6)).toBe("2027-01-03");
  });

  it("formats today in Europe/Prague", () => {
    expect(getPragueTodayISO(new Date("2026-06-30T21:59:00.000Z"))).toBe("2026-06-30");
    expect(getPragueTodayISO(new Date("2026-06-30T22:01:00.000Z"))).toBe("2026-07-01");
    expect(getPragueNow(new Date("2026-06-30T22:01:00.000Z"))).toEqual({
      dateISO: "2026-07-01",
      time: "00:01",
    });
  });
});
