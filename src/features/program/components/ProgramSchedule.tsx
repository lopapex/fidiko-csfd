import { Search, X } from "lucide-react";
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
    <section className="filter-toolbar" aria-label="FiltrovÃ¡nÃ­ programu">
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
            aria-label="Vymazat hledÃ¡nÃ­"
            title="Vymazat hledÃ¡nÃ­"
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
          aria-label="PÅ™edchozÃ­ tÃ½den s programem"
          title="PÅ™edchozÃ­ tÃ½den"
        >
          <span aria-hidden="true">â€¹</span>
        </button>
        <div>
          <span className="week-toolbar-label">Program na tÃ½den</span>
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
          aria-label="DalÅ¡Ã­ tÃ½den s programem"
          title="DalÅ¡Ã­ tÃ½den"
        >
          <span aria-hidden="true">â€º</span>
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
          V tomto tÃ½dnu nejsou projekce odpovÃ­dajÃ­cÃ­ vybranÃ½m filtrÅ¯m.
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
      aria-label="TÃ½dennÃ­ program"
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

function getFilmsSortedByFirstScreeningInWeek(films: FilmGroup[], days: string[]) {
  const dayOrder = new Map(days.map((day, index) => [day, index]));

  return [...films].sort((left, right) => (
    compareFirstScreeningInWeek(left, right, dayOrder)
    || left.title.localeCompare(right.title, "cs-CZ")
  ));
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
          aria-label="PÅ™edchozÃ­ tÃ½den"
        >
          <span aria-hidden="true">â€¹</span>
        </button>
        <div>
          <span className="week-toolbar-label">{label}</span>
          <h2>{formatWeekRange(start, end)}</h2>
        </div>
        <button
          className="week-nav-button"
          type="button"
          disabled
          aria-label="DalÅ¡Ã­ tÃ½den"
        >
          <span aria-hidden="true">â€º</span>
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
          aria-label="Dny v tÃ½dnu"
        >
          {days.map(day => (
            <button
              className="day-tab-skeleton"
              type="button"
              role="tab"
              aria-label="NaÄÃ­tÃ¡nÃ­ dne"
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
    <section className="program-list" aria-label="NaÄÃ­tÃ¡nÃ­ programu">
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






