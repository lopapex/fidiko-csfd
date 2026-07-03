import { describe, expect, it } from "vitest";
import { getStaleRadarWeekKeys } from "../radar-cache";

describe("Radar cache helpers", () => {
  it("removes weekly snapshots outside retained weeks and older versions", () => {
    const keys = [
      "current-v19",
      "week-v18/2026-06-29",
      "week-v18/2026-07-06",
      "week-v17/2026-06-29",
      "week-v99/not-a-date",
      "other/2026-06-29",
    ];

    expect(getStaleRadarWeekKeys(keys, new Set(["2026-06-29"]))).toEqual([
      "week-v18/2026-07-06",
      "week-v17/2026-06-29",
    ]);
  });
});
