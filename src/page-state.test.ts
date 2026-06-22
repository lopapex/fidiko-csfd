import { afterEach, describe, expect, it, vi } from "vitest";
import { readPageState, startOfWeek, validFilmId, validISODate, writePageState } from "./page-state";
import type { PageState } from "./types";

afterEach(() => vi.unstubAllGlobals());

describe("page dates", () => {
  it("finds a Czech Monday across a year boundary", () => {
    expect(startOfWeek("2027-01-01")).toBe("2026-12-28");
    expect(startOfWeek("2026-06-21")).toBe("2026-06-15");
  });

  it("rejects invalid ISO calendar dates", () => {
    expect(validISODate("2026-02-29")).toBeNull();
    expect(validISODate("2026-06-21")).toBe("2026-06-21");
  });

  it("restores a target film only in Program All", () => {
    vi.stubGlobal("localStorage", { removeItem: vi.fn() });
    vi.stubGlobal("sessionStorage", { removeItem: vi.fn(), getItem: vi.fn(() => "all") });
    const location = { search: "?mode=program&view=all&film=po-vecerce" } as Location;
    expect(readPageState(location).filmId).toBe("po-vecerce");
    expect(readPageState({ search: "?mode=radar&film=po-vecerce" } as Location).filmId).toBeNull();
    expect(validFilmId("../film")).toBeNull();
  });

  it("writes the target film into a shareable Program URL", () => {
    const pushState = vi.fn();
    vi.stubGlobal("window", {
      location: { pathname: "/", hash: "" },
      history: { pushState, replaceState: vi.fn() },
    });
    const page: PageState = {
      mode: "program",
      view: "all",
      week: null,
      day: null,
      query: "",
      subtitles: false,
      radarWeek: null,
      radarDay: null,
      filmId: "po-vecerce",
    };
    writePageState(page, "push");
    expect(pushState).toHaveBeenCalledWith(null, "", "/?mode=program&view=all&film=po-vecerce");
  });
});
