import { useMemo } from "react";
import { Search, X } from "lucide-react";
import type { FilmGroup, PageState, ScheduleResponse, Screening } from "../../../types";
import { getPragueTodayISO, startOfWeek } from "../../../shared/state/page-state";
import { getScreeningSortMinutes, getWeekDays } from "../../../shared/lib/view-helpers";
import { WeekView, WeekViewSkeleton, type WeekContent } from "../../../shared/components/WeekView";
import { ProgramAgendaItem } from "./ProgramCards";

export function FilterToolbar({
  page,
  onChange,
}: {
  page: PageState;
  onChange: (patch: Partial<PageState>, mode?: "push" | "replace") => void;
}) {
  return (
    <section className="filter-toolbar" aria-label="Filtrování programu">
      <label className="search-field">
        <Search size={18} aria-hidden="true" />
        <span className="sr-only">Hledat film</span>
        <input
          value={page.query}
          onChange={event => onChange({ query: event.target.value }, "replace")}
          placeholder="Hledat film"
          type="search"
        />
        {page.query ? (
          <button
            className="search-clear-button"
            type="button"
            onClick={() => onChange({ query: "" }, "replace")}
            aria-label="Vymazat hledání"
            title="Vymazat hledání"
          >
            <X size={16} />
          </button>
        ) : null}
      </label>
      <button
        className={page.subtitles ? "filter-button active" : "filter-button"}
        type="button"
        aria-pressed={page.subtitles}
        onClick={() => onChange({ subtitles: !page.subtitles })}
      >
        Titulky
      </button>
    </section>
  );
}

export function WeeklySchedule({
  data,
  films,
  getWeekFilms,
  selectedDay,
  landOnSelectedDay,
  onNavigate,
  onDayChange,
  onSelectFilm,
}: {
  data: ScheduleResponse;
  films: FilmGroup[];
  /** Films of another week, for the neighbours revealed while swiping. */
  getWeekFilms: (weekStart: string) => FilmGroup[] | null;
  selectedDay: string | null;
  landOnSelectedDay: boolean;
  onNavigate: (week: string) => void;
  onDayChange: (day: string) => void;
  onSelectFilm: (id: string) => void;
}) {
  const { period } = data;
  const weekStart = period.weekStart ?? "";
  const { previousWeekStart, nextWeekStart } = period;

  // Films per day for this week and both neighbours (all derived locally, no network).
  const byDay = useMemo(() => getFilmsByDay(films, weekStart), [films, weekStart]);
  const previousByDay = useMemo(() => {
    const weekFilms = previousWeekStart ? getWeekFilms(previousWeekStart) : null;
    return previousWeekStart && weekFilms ? getFilmsByDay(weekFilms, previousWeekStart) : null;
  }, [getWeekFilms, previousWeekStart]);
  const nextByDay = useMemo(() => {
    const weekFilms = nextWeekStart ? getWeekFilms(nextWeekStart) : null;
    return nextWeekStart && weekFilms ? getFilmsByDay(weekFilms, nextWeekStart) : null;
  }, [getWeekFilms, nextWeekStart]);

  const today = getPragueTodayISO();
  const toContent = (filmsByDay: Map<string, FilmGroup[]>, interactive: boolean): WeekContent => ({
    days: [...filmsByDay.keys()],
    notice: [...filmsByDay.values()].every(dayFilms => dayFilms.length === 0) ? "Tento týden se nepromítá." : undefined,
    getDayMeta: day => {
      const dayFilms = filmsByDay.get(day) ?? [];
      return {
        empty: dayFilms.length === 0,
        // Only inside the running week; a whole week looked up in the past stays readable.
        past: day < today && today <= ([...filmsByDay.keys()].at(-1) ?? ""),
        hasSubtitles: dayFilms.some(film => film.screenings.some(screening => screening.hasSubtitles)),
      };
    },
    renderDay: day =>
      (filmsByDay.get(day) ?? []).map((film, index) => (
        <ProgramAgendaItem
          film={film}
          priority={interactive && index === 0}
          onSelectFilm={onSelectFilm}
          key={film.id}
        />
      )),
  });

  return (
    <WeekView
      idPrefix="program"
      title="Program na týden"
      today={today}
      selectedDay={selectedDay}
      landOnSelectedDay={landOnSelectedDay}
      current={toContent(byDay, true)}
      previous={previousByDay ? toContent(previousByDay, false) : null}
      next={nextByDay ? toContent(nextByDay, false) : null}
      previousWeekStart={previousWeekStart}
      nextWeekStart={nextWeekStart}
      onNavigate={onNavigate}
      onDayChange={onDayChange}
      emptyDayText="Bez projekce"
    />
  );
}

function getFilmsByDay(films: FilmGroup[], weekStart: string) {
  return new Map(getWeekDays(weekStart).map(day => [day, getFilmsForDay(films, day)]));
}

function getFilmsForDay(films: FilmGroup[], day: string) {
  return films
    .map(film => ({
      ...film,
      screenings: film.screenings
        .filter(screening => screening.dateISO === day)
        .sort(compareScreeningTime),
    }))
    .filter(film => film.screenings.length > 0)
    .sort((left, right) => compareScreeningTime(left.screenings[0], right.screenings[0]));
}

function compareScreeningTime(left: Screening, right: Screening) {
  return getScreeningSortMinutes(left.time) - getScreeningSortMinutes(right.time);
}

export function WeeklyLoading({ weekStart }: { weekStart: string | null }) {
  const days = getWeekDays(weekStart ?? startOfWeek(getPragueTodayISO()));
  return <WeekViewSkeleton days={days} label="Načítání programu" />;
}

export function LoadingRows() {
  return (
    <section className="program-list" aria-label="Načítání filmů" aria-busy="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <div className="film-card film-card-skeleton" key={index}>
          <span className="poster poster-full skeleton" />
          <div className="film-card-copy">
            <span className="skeleton-line wide" />
            <span className="skeleton-line" />
            <span className="skeleton-line short" />
          </div>
        </div>
      ))}
    </section>
  );
}
