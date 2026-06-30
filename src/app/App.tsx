import { useEffect, useMemo, useRef, useState } from "react";
import { ProgramView } from "../features/program/ProgramView";
import { FilmRow } from "../features/program/components/ProgramCards";
import { FilterToolbar, LoadingRows, WeeklyLoading, WeeklySchedule } from "../features/program/components/ProgramSchedule";
import { RadarView } from "../features/radar/RadarView";
import { RadarWeeklyLoading, RadarWeeklySchedule } from "../features/radar/components/RadarWeeklySchedule";
import { fetchJson, storeApiResult } from "../shared/api/api";
import { AppHeader } from "../shared/components/AppHeader";
import { getPragueTodayISO, readPageState, startOfWeek, storeViewMode, writePageState } from "../shared/state/page-state";
import { getWeekDays } from "../shared/lib/view-helpers";
import { useApiResource } from "../shared/api/use-api-resource";
import type {
  AppMode,
  InstallPromptEvent,
  PageState,
  RadarResponse,
  ScheduleResponse,
  ViewMode,
} from "../types";
const POSTER_PLACEHOLDER_SRC = "/poster-placeholder.png";

function getScheduleUrl(page: PageState) {
  if (page.view !== "week") return "/api/schedule";
  return `/api/schedule?view=week${page.week ? `&week=${encodeURIComponent(page.week)}` : ""}`;
}

function getRadarUrl(page: PageState) {
  return `/api/radar?period=week${page.radarWeek ? `&week=${encodeURIComponent(page.radarWeek)}` : ""}`;
}

export const App = () => {
  const [page, setPage] = useState<PageState>(readPageState);
  const pageRef = useRef(page);
  const [scheduleRetry, setScheduleRetry] = useState(0);
  const [radarRetry, setRadarRetry] = useState(0);
  const [radarPreparing, setRadarPreparing] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  );
  const load = useApiResource<ScheduleResponse>(
    page.mode === "program" ? getScheduleUrl(page) : null,
    scheduleRetry,
    setOffline,
  );
  const radarLoad = useApiResource<RadarResponse>(
    page.mode === "radar" ? getRadarUrl(page) : null,
    radarRetry,
    setOffline,
  );

  useEffect(() => {
    const onPopState = () => {
      const next = readPageState();
      pageRef.current = next;
      setPage(next);
    };
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => setInstallPrompt(null);

    window.addEventListener("popstate", onPopState);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (page.mode !== "radar" || !radarLoad.data?.period.weekStart) return;
    const days = getWeekDays(radarLoad.data.period.weekStart);
    if (page.radarDay && days.includes(page.radarDay)) return;
    const today = getPragueTodayISO();
    const nextDay = days.includes(today)
      ? today
      : (days.find(day =>
          radarLoad.data!.items.some(item => item.releaseDate === day),
        ) ?? days[0]);
    changePage({ radarDay: nextDay }, "replace");
  }, [page.mode, page.radarDay, radarLoad.data]);

  useEffect(() => {
    if (
      page.mode !== "program" ||
      page.view !== "week" ||
      !load.data?.period.weekStart ||
      !load.data.period.weekEnd
    )
      return;
    const days = getWeekDays(load.data.period.weekStart);
    if (page.day && days.includes(page.day)) return;

    const today = getPragueTodayISO();
    const nextDay = days.includes(today)
      ? today
      : (days.find(day =>
          load.data!.films.some(film =>
            film.screenings.some(screening => screening.dateISO === day),
          ),
        ) ?? days[0]);
    changePage({ day: nextDay }, "replace");
  }, [load.data, page.day, page.mode, page.view]);

  useEffect(() => storeViewMode(page.view), [page.view]);

  useEffect(() => {
    if (page.mode !== "radar" || document.getElementById("tmdb-image-preconnect")) return;
    const link = document.createElement("link");
    link.id = "tmdb-image-preconnect";
    link.rel = "preconnect";
    link.href = "https://image.tmdb.org";
    link.crossOrigin = "anonymous";
    document.head.append(link);
  }, [page.mode]);

  useEffect(() => {
    if (
      !page.filmId ||
      page.mode !== "program" ||
      page.view !== "all" ||
      load.status !== "ready" ||
      !load.data ||
      load.data.period.mode !== "all"
    )
      return;
    const animationFrame = window.requestAnimationFrame(() => {
      const target = document.getElementById(page.filmId!);
      target?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [load, page.filmId, page.mode, page.view]);

  const filteredFilms = useMemo(() => {
    if (!load.data) return [];
    const normalizedQuery = page.query.trim().toLocaleLowerCase("cs-CZ");

    return load.data.films
      .filter(
        film =>
          !normalizedQuery ||
          film.title.toLocaleLowerCase("cs-CZ").includes(normalizedQuery),
      )
      .map(film => ({
        ...film,
        screenings: film.screenings.filter(screening => {
          if (page.subtitles && !screening.hasSubtitles) return false;
          return true;
        }),
      }))
      .filter(film => film.screenings.length > 0);
  }, [load.data, page.query, page.subtitles]);

  const radarItems = useMemo(
    () => radarLoad.data?.items ?? [],
    [radarLoad.data?.items],
  );

  const filtersActive = Boolean(page.query || page.subtitles);

  function changePage(
    patch: Partial<PageState>,
    mode: "push" | "replace" = "push",
  ) {
    const current = pageRef.current;
    const clearsFilm =
      patch.filmId === undefined &&
      (patch.mode !== undefined ||
        patch.view !== undefined ||
        patch.week !== undefined ||
        patch.day !== undefined ||
        patch.query !== undefined ||
        patch.subtitles !== undefined);
    const next = { ...current, ...patch, ...(clearsFilm ? { filmId: null } : {}) };
    pageRef.current = next;
    writePageState(next, mode);
    setPage(next);
  }

  function changeView(view: ViewMode) {
    if (view === page.view) return;
    changePage({ view, week: null, day: null, query: "", subtitles: false, filmId: null });
  }

  function changeMode(mode: AppMode) {
    if (mode === page.mode) return;
    changePage({
      mode,
      week: null,
      day: null,
      radarWeek: null,
      radarDay: null,
      query: "",
      subtitles: false,
      filmId: null,
    });
  }

  function showFilmInAll(id: string) {
    changePage({
      mode: "program",
      view: "all",
      week: null,
      day: null,
      query: "",
      subtitles: false,
      filmId: id,
    });
  }

  async function prepareRadarWeek() {
    const current = pageRef.current;
    if (current.mode !== "radar" || radarPreparing) return;
    const radarUrl = getRadarUrl(current);
    const refreshUrl = `${radarUrl}${radarUrl.includes("?") ? "&" : "?"}refresh=1&_=${Date.now()}`;
    setRadarPreparing(true);
    try {
      const result = await fetchJson<RadarResponse>(refreshUrl, undefined, {
        cache: "no-store",
      });
      storeApiResult(radarUrl, result);
      setRadarRetry(value => value + 1);
    } catch (error) {
      console.error("Radar week preparation failed", error);
      setRadarRetry(value => value + 1);
    } finally {
      setRadarPreparing(false);
    }
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  return (
    <main className="app-shell">
      <AppHeader
        mode={page.mode}
        view={page.view}
        canInstall={Boolean(installPrompt)}
        onModeChange={changeMode}
        onViewChange={changeView}
        onInstall={() => void installApp()}
      />
      {page.mode === "radar" ? (
        <RadarView
          load={radarLoad}
          offline={offline}
          onRetry={() => setRadarRetry(value => value + 1)}
          renderLoading={() => <RadarWeeklyLoading weekStart={page.radarWeek} />}
          renderSchedule={data => (
            <RadarWeeklySchedule
              data={data}
              items={radarItems}
              selectedDay={page.radarDay}
              preparing={radarPreparing}
              onNavigate={week => changePage({ radarWeek: week, radarDay: null })}
              onDayChange={day => changePage({ radarDay: day })}
              onPrepareWeek={() => void prepareRadarWeek()}
              onSelectProgramFilm={showFilmInAll}
            />
          )}
        />
      ) : (
        <ProgramView
          view={page.view}
          load={load}
          films={filteredFilms}
          filtersActive={filtersActive}
          offline={offline}
          toolbar={<FilterToolbar page={page} onChange={changePage} />}
          onRetry={() => setScheduleRetry(value => value + 1)}
          renderLoading={view => view === "week" ? <WeeklyLoading weekStart={page.week} /> : <LoadingRows />}
          renderWeekly={(data, films) => (
            <WeeklySchedule
              data={data}
              films={films}
              selectedDay={page.day}
              onNavigate={week => changePage({ week, day: null })}
              onDayChange={day => changePage({ day })}
              onSelectFilm={showFilmInAll}
            />
          )}
          renderFilm={(film, index) => (
            <FilmRow
              film={film}
              priority={index === 0}
              key={film.id}
            />
          )}
        />
      )}
    </main>
  );
};


