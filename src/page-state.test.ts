import { describe, expect, it } from "vitest";
import { startOfWeek, validISODate } from "./page-state";

describe("page dates", () => {
  it("finds a Czech Monday across a year boundary", () => {
    expect(startOfWeek("2027-01-01")).toBe("2026-12-28");
    expect(startOfWeek("2026-06-21")).toBe("2026-06-15");
  });

  it("rejects invalid ISO calendar dates", () => {
    expect(validISODate("2026-02-29")).toBeNull();
    expect(validISODate("2026-06-21")).toBe("2026-06-21");
  });
});
