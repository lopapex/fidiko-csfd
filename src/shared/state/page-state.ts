import type { PageState, ViewMode } from "../../types";

const VIEW_MODE_KEY = "nzfd-view-mode-v2";

export const readPageState = (location = window.location): PageState => {
  const params = new URLSearchParams(location.search);
  const modeParam = params.get("mode");
  const mode = modeParam === "radar" || modeParam === "program" ? modeParam : "program";
  const viewParam = params.get("view");
  const view: ViewMode = viewParam === "week" || viewParam === "all" ? viewParam : readStoredViewMode();
  const filmId = validFilmId(params.get("film"));
  return {
    mode,
    view,
    week: validISODate(params.get("week")),
    day: validISODate(params.get("day")),
    query: params.get("q") ?? "",
    subtitles: params.get("subtitles") === "1",
    radarWeek: validISODate(params.get("week")) ?? startOfWeek(getPragueTodayISO()),
    radarDay: mode === "radar" ? validISODate(params.get("day")) : null,
    filmId: mode === "program" && view === "all" ? filmId : null,
  };
};

export const writePageState = (page: PageState, mode: "push" | "replace") => {
  const params = new URLSearchParams();
  params.set("mode", page.mode);
  if (page.mode === "radar") {
    params.set("period", "week");
    if (page.radarWeek) params.set("week", page.radarWeek);
    if (page.radarDay) params.set("day", page.radarDay);
  } else {
    params.set("view", page.view);
    if (page.view === "week" && page.week) params.set("week", page.week);
    if (page.view === "week" && page.day) params.set("day", page.day);
    if (page.query) params.set("q", page.query);
    if (page.subtitles) params.set("subtitles", "1");
    if (page.view === "all" && page.filmId) params.set("film", page.filmId);
  }
  const url = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  window.history[mode === "push" ? "pushState" : "replaceState"](null, "", url);
};

export const storeViewMode = (view: ViewMode) => {
  try {
    sessionStorage.setItem(VIEW_MODE_KEY, view);
  } catch {
    // Session preferences are optional when storage is unavailable.
  }
};

export const validISODate = (value: string | null) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
};

export const validFilmId = (value: string | null) => {
  return value && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : null;
};

export const getPragueTodayISO = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export const startOfWeek = (value: string) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return date.toISOString().slice(0, 10);
};

const readStoredViewMode = (): ViewMode => {
  try {
    localStorage.removeItem("nzfd-view-mode");
    sessionStorage.removeItem("nzfd-view-mode");
    const stored = sessionStorage.getItem(VIEW_MODE_KEY);
    return stored === "all" || stored === "week" ? stored : "all";
  } catch {
    return "all";
  }
};

