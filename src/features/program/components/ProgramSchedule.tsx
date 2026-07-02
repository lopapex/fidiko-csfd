import { Search, X, ChevronLeft, ChevronRight } from "lucide-react";
import type { FilmGroup, PageState, ScheduleResponse, Screening } from "../../../types";
import { getPragueTodayISO, startOfWeek } from "../../../shared/state/page-state";
import { MobileAgendaHeader, MobileAgendaSkeleton, WeeklySkeletonTable } from "../../radar/components/RadarWeeklySchedule";
import { CompactScreening, FilmMini, MobileProgramAgendaItem } from "./ProgramCards";
import {
  formatShortDate,
  formatWeekRange,
  formatWeekday,
  getWeekDays,
} from "../../../shared/lib/view-helpers";
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
  selectedDay,
  onNavigate,
  onDayChange,
  onSelectFilm,
}: {
  data: ScheduleResponse;
  films: FilmGroup[];
  selectedDay: string | null;
  onNavigate: (week: string) => void;
  onDayChange: (day: string) => void;
  onSelectFilm: (id: string) => void;
}) {
  const { period } = data;
  const days = period.weekStart ? getWeekDays(period.weekStart) : [];
  const today = getPragueTodayISO();
  const activeDay =
    selectedDay && days.includes(selectedDay) ? selectedDay : days[0];

  return (
    <section className="weekly-program" aria-labelledby="weekly-program-title">
      <div className="week-toolbar">
        <button
          className="week-nav-button"
          type="button"
          disabled={!period.previousWeekStart}
          onClick={() =>
            period.previousWeekStart && onNavigate(period.previousWeekStart)
          }
          aria-label="Předchozí týden s programem"
          title="Předchozí týden"
        >
          <ChevronLeft size={24} aria-hidden="true" />
        </button>
        <div>
          <span className="week-toolbar-label">Program na týden</span>
          <h2 id="weekly-program-title">
            {formatWeekRange(period.weekStart, period.weekEnd)}
          </h2>
        </div>
        <button
          className="week-nav-button"
          type="button"
          disabled={!period.nextWeekStart}
          onClick={() =>
            period.nextWeekStart && onNavigate(period.nextWeekStart)
          }
          aria-label="Další týden s programem"
          title="Další týden"
        >
          <ChevronRight size={24} aria-hidden="true" />
        </button>
      </div>

      {films.length > 0 ? (
        <>
          <div className="weekly-desktop">
            <WeeklyTable
              films={films}
              days={days}
              today={today}
              onSelectFilm={onSelectFilm}
            />
          </div>
          <div className="weekly-mobile">
            <MobileWeek
              films={films}
              days={days}
              today={today}
              onSelectFilm={onSelectFilm}
            />
          </div>
        </>
      ) : (
        <div className="empty-box weekly-empty">
          V tomto týdnu nejsou projekce odpovídající vybraným filtrům.
        </div>
      )}
    </section>
  );
}

function WeeklyTable({
  films,
  days,
  today,
  onSelectFilm,
}: {
  films: FilmGroup[];
  days: string[];
  today: string;
  onSelectFilm: (id: string) => void;
}) {
  const sortedFilms = getFilmsSortedByFirstScreeningInWeek(films, days);

  return (
    <div
      className="weekly-table-scroll"
      role="region"
      aria-label="Týdenní program"
      tabIndex={0}
    >
      <table className="weekly-table">
        <thead>
          <tr>
            <th className="weekly-film-heading" scope="col">
              Film
            </th>
            {days.map(day => (
              <th
                className={day === today ? "weekly-today" : undefined}
                scope="col"
                key={day}
                aria-current={day === today ? "date" : undefined}
              >
                <span>{formatWeekday(day)}</span>
                <strong>{formatShortDate(day)}</strong>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedFilms.map(film => (
            <tr key={film.id}>
              <th className="weekly-film-cell" scope="row">
                <FilmMini film={film} onSelectFilm={onSelectFilm} />
              </th>
              {days.map(day => {
                const screenings = film.screenings
                  .filter(screening => screening.dateISO === day)
                  .sort(compareScreeningTime);
                return (
                  <td
                    key={day}
                    aria-label={
                      screenings.length === 0
                        ? `${film.title}: bez projekce`
                        : undefined
                    }
                  >
                    <div className="weekly-times">
                      {screenings.map(screening => (
                        <CompactScreening
                          film={film}
                          screening={screening}
                          key={screening.id}
                        />
                      ))}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MobileWeek({
  films,
  days,
  today,
  onSelectFilm,
}: {
  films: FilmGroup[];
  days: string[];
  today: string;
  onSelectFilm: (id: string) => void;
}) {
  return (
    <div className="mobile-week mobile-week-agenda">
      {days.map(day => {
        const dayFilms = getFilmsForDay(films, day);
        const screeningCount = dayFilms.reduce(
          (sum, film) => sum + film.screenings.length,
          0,
        );
        const hasSubtitles = dayFilms.some(film =>
          film.screenings.some(screening => screening.hasSubtitles),
        );
        return (
          <section
            className={[
              "mobile-agenda-day",
              "mobile-agenda-program-day",
              day === today ? "today" : "",
              hasSubtitles ? "has-subtitles" : "",
              screeningCount === 0 ? "empty" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-labelledby={`program-mobile-day-${day}`}
            key={day}
          >
            <MobileAgendaHeader
              id={`program-mobile-day-${day}`}
              day={day}
              today={today}
            />
            {dayFilms.length ? (
              <div className="mobile-agenda-items">
                {dayFilms.map((film, index) => (
                  <MobileProgramAgendaItem
                    film={film}
                    priority={index === 0}
                    onSelectFilm={onSelectFilm}
                    key={film.id}
                  />
                ))}
              </div>
            ) : (
              <div className="mobile-agenda-empty">Bez projekce.</div>
            )}
          </section>
        );
      })}
    </div>
  );

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
    .sort((left, right) =>
      compareScreeningTime(left.screenings[0], right.screenings[0]),
    );
}

export function getFilmsSortedByFirstScreeningInWeek(films: FilmGroup[], days: string[]) {
  const dayOrder = new Map(days.map((day, index) => [day, index]));
  const baseSortedFilms = [...films].sort((left, right) => (
    compareFirstScreeningInWeek(left, right, dayOrder)
    || left.title.localeCompare(right.title, "cs-CZ")
  ));
  const priority = new Map(baseSortedFilms.map((film, index) => [film.id, index]));
  const byId = new Map(films.map(film => [film.id, film]));
  const edges = new Map(films.map(film => [film.id, new Set<string>()]));
  const indegrees = new Map(films.map(film => [film.id, 0]));

  for (const day of days) {
    const dayFilms = films
      .map(film => ({ film, screening: getFirstScreeningForDay(film, day) }))
      .filter((entry): entry is { film: FilmGroup; screening: Screening } => entry.screening !== null)
      .sort((left, right) => (
        compareScreeningTime(left.screening, right.screening)
        || (priority.get(left.film.id) ?? Number.POSITIVE_INFINITY) - (priority.get(right.film.id) ?? Number.POSITIVE_INFINITY)
      ));

    for (let leftIndex = 0; leftIndex < dayFilms.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < dayFilms.length; rightIndex += 1) {
        if (compareScreeningTime(dayFilms[leftIndex].screening, dayFilms[rightIndex].screening) === 0) continue;
        addOrderingEdge(dayFilms[leftIndex].film.id, dayFilms[rightIndex].film.id, edges, indegrees);
      }
    }
  }

  const ordered: FilmGroup[] = [];
  const remaining = new Set(films.map(film => film.id));
  while (remaining.size > 0) {
    const nextId = [...remaining]
      .filter(id => (indegrees.get(id) ?? 0) === 0)
      .sort((left, right) => (priority.get(left) ?? 0) - (priority.get(right) ?? 0))[0]
      ?? [...remaining].sort((left, right) => (priority.get(left) ?? 0) - (priority.get(right) ?? 0))[0];
    const film = byId.get(nextId);
    if (!film) break;

    ordered.push(film);
    remaining.delete(nextId);
    for (const target of edges.get(nextId) ?? []) {
      indegrees.set(target, Math.max(0, (indegrees.get(target) ?? 0) - 1));
    }
  }

  return ordered;
}

function addOrderingEdge(
  beforeId: string,
  afterId: string,
  edges: Map<string, Set<string>>,
  indegrees: Map<string, number>,
) {
  const outgoing = edges.get(beforeId);
  if (!outgoing || outgoing.has(afterId)) return;
  outgoing.add(afterId);
  indegrees.set(afterId, (indegrees.get(afterId) ?? 0) + 1);
}

function getFirstScreeningForDay(film: FilmGroup, day: string) {
  return film.screenings
    .filter(screening => screening.dateISO === day)
    .sort(compareScreeningTime)[0] ?? null;
}

function compareFirstScreeningInWeek(
  left: FilmGroup,
  right: FilmGroup,
  dayOrder: Map<string, number>,
) {
  const leftScreening = getFirstScreeningInWeek(left, dayOrder);
  const rightScreening = getFirstScreeningInWeek(right, dayOrder);
  const leftDay = leftScreening ? dayOrder.get(leftScreening.dateISO) ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
  const rightDay = rightScreening ? dayOrder.get(rightScreening.dateISO) ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;

  return leftDay - rightDay
    || compareOptionalScreeningTime(leftScreening, rightScreening);
}

function getFirstScreeningInWeek(film: FilmGroup, dayOrder: Map<string, number>) {
  return film.screenings
    .filter(screening => dayOrder.has(screening.dateISO))
    .sort((left, right) => (
      (dayOrder.get(left.dateISO) ?? Number.POSITIVE_INFINITY)
      - (dayOrder.get(right.dateISO) ?? Number.POSITIVE_INFINITY)
      || compareScreeningTime(left, right)
    ))[0] ?? null;
}

function compareOptionalScreeningTime(left: Screening | null, right: Screening | null) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return compareScreeningTime(left, right);
}

function compareScreeningTime(left: Screening, right: Screening) {
  return getScreeningSortMinutes(left) - getScreeningSortMinutes(right);
}

function getScreeningSortMinutes(screening: Screening) {
  if (!screening.time) return Number.POSITIVE_INFINITY;
  const match = screening.time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function WeeklyLoading({
  weekStart,
  label = "Program na týden",
}: {
  weekStart: string | null;
  label?: string;
}) {
  const start = weekStart ?? startOfWeek(getPragueTodayISO());
  const days = getWeekDays(start);
  const end = days[6];

  return (
    <section
      className="weekly-program"
      aria-label="Načítání týdenního programu"    >
      <div className="week-toolbar">
        <button
          className="week-nav-button"
          type="button"
          disabled
          aria-label="Předchozí týden"
        >
          <ChevronLeft size={24} aria-hidden="true" />
        </button>
        <div>
          <span className="week-toolbar-label">{label}</span>
          <h2>{formatWeekRange(start, end)}</h2>
        </div>
        <button
          className="week-nav-button"
          type="button"
          disabled
          aria-label="Další týden"
        >
          <ChevronRight size={24} aria-hidden="true" />
        </button>
      </div>
      <div className="weekly-desktop">
        <div className="weekly-table-scroll">
          <WeeklySkeletonTable days={days} heading="Film" />
        </div>
      </div>
      <div className="weekly-mobile">
        <MobileAgendaSkeleton days={days} />
        <div
          className="mobile-day-tabs"
          hidden
          role="tablist"
          aria-label="Dny v týdnu"
        >
          {days.map(day => (
            <button
              className="day-tab-skeleton"
              type="button"
              role="tab"
              aria-label="Načítání dne"
              disabled
              key={day}
            >
              <span className="skeleton day-name-skeleton" />
              <span className="skeleton day-date-skeleton" />
            </button>
          ))}
        </div>
        <div className="mobile-day-program" hidden>
          <LoadingRows />
        </div>
      </div>
    </section>
  );
}

export function LoadingRows() {
  return (
    <section className="program-list" aria-label="Načítání programu">
      {Array.from({ length: 4 }).map((_, index) => (
        <div className="film-row loading-row" key={index}>
          <div className="film-info">
            <div className="poster-frame skeleton" />
            <div className="film-copy">
              <div className="skeleton-line wide" />
              <div className="skeleton-line" />
              <div className="skeleton-line short" />
            </div>
          </div>
          <div className="screening-grid">
            <div className="screening-button skeleton-button" />
            <div className="screening-button skeleton-button" />
            <div className="screening-button skeleton-button" />
          </div>
        </div>
      ))}
    </section>
  );
}






