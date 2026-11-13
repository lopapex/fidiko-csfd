import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ProgramView } from "../features/program/ProgramView";
import { FilmRow } from "../features/program/components/ProgramCards";
import { FilterToolbar, LoadingRows, WeeklyLoading, WeeklySchedule } from "../features/program/components/ProgramSchedule";
import { RadarView } from "../features/radar/RadarView";
import { RadarWeeklyLoading, RadarWeeklySchedule } from "../features/radar/components/RadarWeeklySchedule";
import { AppHeader, type AppSection } from "../shared/components/AppHeader";
import { getPragueTodayISO, readPageState, startOfWeek, storeViewMode, writePageState } from "../shared/state/page-state";
import { createWeeklySchedule } from "../../netlify/lib/shared/schedule-week";
import { getWeekDays } from "../shared/lib/view-helpers";
import { useApiResource } from "../shared/api/use-api-resource";
import { fetchJson, getCachedApi } from "../shared/api/api";
import { runViewTransition, type NavDirection } from "../shared/lib/view-transition";
import { DataFreshness } from "../shared/components/DataFreshness";
import { ToastHost } from "../shared/components/Toast";
import { usePullToRefresh } from "./use-pull-to-refresh";
import { useInstallPrompt } from "./use-install-prompt";
import { useOnlineStatus } from "./use-online-status";
import type {
  LoadState,
  PageState,
  RadarResponse,
  ScheduleResponse,
} from "../types";

// The full schedule is small (~6 kB gzip); weeks are derived from it on the client
// so week navigation and the Program/Filmy switch never wait for the network.
const SCHEDULE_URL = "/api/schedule";

const getRadarUrl = (page: Pick<PageState, "radarWeek">) => {
  return `/api/radar?period=week${page.radarWeek ? `&week=${encodeURIComponent(page.radarWeek)}` : ""}`;
};

/** Section changes crossfade; week changes animate inside WeekView (card swipe). */
const getNavDirection = (current: PageState, next: PageState): NavDirection | null =>
  current.mode !== next.mode || current.view !== next.view ? "none" : null;

const whenIdle = (callback: () => void) => {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(callback, { timeout: 4000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, 1500);
  return () => window.clearTimeout(handle);
};

export const App = () => {
  const [page, setPage] = useState<PageState>(readPageState);
  const pageRef = useRef(page);
  const [scheduleRetry, setScheduleRetry] = useState(0);
  const [radarRetry, setRadarRetry] = useState(0);
  const [offline, setOffline] = useOnlineStatus();
  const { canInstall, installApp } = useInstallPrompt();
  const pullToRefresh = usePullToRefresh(() => {
    if (pageRef.current.mode === "radar") setRadarRetry(value => value + 1);
    else setScheduleRetry(value => value + 1);
  });
  const load = useApiResource<ScheduleResponse>(
    page.mode === "program" ? SCHEDULE_URL : null,
    scheduleRetry,
    setOffline,
  );
  const radarLoad = useApiResource<RadarResponse>(
    page.mode === "radar" ? getRadarUrl(page) : null,
    radarRetry,
    setOffline,
  );

  const scheduleData = useMemo<ScheduleResponse | null>(() => {
    if (!load.data) return null;
    if (page.view !== "week") return load.data;
    return createWeeklySchedule(load.data, page.week ? startOfWeek(page.week) : null);
  }, [load.data, page.view, page.week]);

  const programLoad = useMemo<LoadState<ScheduleResponse>>(
    () => ({ ...load, data: scheduleData }),
    [load, scheduleData],
  );

  useEffect(() => {
    const onPopState = () => {
      const next = readPageState();
      pageRef.current = next;
      setPage(next);
    };

    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);
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
      !scheduleData?.period.weekStart ||
      !scheduleData.period.weekEnd
    )
      return;
    const days = getWeekDays(scheduleData.period.weekStart);
    if (page.day && days.includes(page.day)) return;

    const today = getPragueTodayISO();
    const nextDay = days.includes(today)
      ? today
      : (days.find(day =>
          scheduleData.films.some(film =>
            film.screenings.some(screening => screening.dateISO === day),
          ),
        ) ?? days[0]);
    changePage({ day: nextDay }, "replace");
  }, [scheduleData, page.day, page.mode, page.view]);

  useEffect(() => storeViewMode(page.view), [page.view]);

  // Warm both neighbouring radar weeks: swiping reveals their real content and opens them without a skeleton.
  const [radarPrefetchTick, setRadarPrefetchTick] = useState(0);
  const radarReady = page.mode === "radar" && radarLoad.status === "ready";
  const nextRadarWeek = radarReady ? radarLoad.data?.period.nextWeekStart ?? null : null;
  const previousRadarWeek = radarReady ? radarLoad.data?.period.previousWeekStart ?? null : null;
  useEffect(() => {
    if (offline) return;
    const urls = [nextRadarWeek, previousRadarWeek]
      .filter((week): week is string => Boolean(week))
      .map(week => getRadarUrl({ radarWeek: week }))
      .filter(url => !getCachedApi(url)?.fresh);
    if (!urls.length) return;
    return whenIdle(() => {
      void Promise.allSettled(urls.map(url => fetchJson(url))).then(() => {
        // Prefetch is best effort; re-render so the swipe neighbours pick up the cached weeks.
        setRadarPrefetchTick(value => value + 1);
      });
    });
  }, [nextRadarWeek, previousRadarWeek, offline]);

  const getRadarWeekItems = useCallback(
    (week: string) => {
      const cached = getCachedApi<RadarResponse>(getRadarUrl({ radarWeek: week }));
      if (!cached) return null;
      return cached.data.status === "missing" ? [] : cached.data.items;
    },
    // Re-read the cache after a prefetch lands.
    [radarPrefetchTick],
  );

  const getProgramWeekFilms = useCallback(
    (week: string) => (load.data ? createWeeklySchedule(load.data, week).films : null),
    [load.data],
  );

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
    if (!scheduleData) return [];
    const normalizedQuery = page.query.trim().toLocaleLowerCase("cs-CZ");

    return scheduleData.films
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
  }, [scheduleData, page.query, page.subtitles]);

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

    const direction = getNavDirection(current, next);
    if (direction) {
      runViewTransition(() => setPage(next), direction);
    } else {
      setPage(next);
    }
  }

  const section: AppSection = page.mode === "radar" ? "radar" : page.view === "all" ? "films" : "program";

  function changeSection(next: AppSection) {
    if (next === section) return;
    changePage({
      mode: next === "radar" ? "radar" : "program",
      view: next === "films" ? "all" : "week",
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

  const refreshing = page.mode === "radar" ? radarLoad.refreshing : load.refreshing;
  const freshnessAt = page.mode === "radar" ? radarLoad.data?.fetchedAt : load.data?.fetchedAt;

  return (
    <main className="app-shell">
      {pullToRefresh.pull > 0 ? (
        <div
          className={pullToRefresh.ready ? "pull-indicator ready" : "pull-indicator"}
          style={{ transform: `translate(-50%, ${pullToRefresh.pull}px)` }}
          aria-hidden="true"
        >
          <RefreshCw size={20} style={{ transform: `rotate(${pullToRefresh.pull * 3}deg)` }} />
        </div>
      ) : null}
      {refreshing ? (
        <div className="refresh-bar" role="status">
          <span className="sr-only">Aktualizuji data</span>
        </div>
      ) : null}
      <AppHeader
        section={section}
        canInstall={canInstall}
        onSectionChange={changeSection}
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
              getWeekItems={getRadarWeekItems}
              selectedDay={page.radarDay}
              onNavigate={week => changePage({ radarWeek: week, radarDay: null })}
              onDayChange={day => changePage({ radarDay: day }, "replace")}
              onSelectProgramFilm={showFilmInAll}
            />
          )}
        />
      ) : (
        <ProgramView
          view={page.view}
          load={programLoad}
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
              getWeekFilms={getProgramWeekFilms}
              selectedDay={page.day}
              onNavigate={week => changePage({ week, day: null })}
              onDayChange={day => changePage({ day }, "replace")}
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
      <DataFreshness
        label={page.mode === "radar" ? "Radar aktualizován" : "Program aktualizován"}
        fetchedAt={freshnessAt ?? null}
      />
      <ToastHost />
    </main>
  );
};


