import { ChevronLeft, ChevronRight } from "lucide-react";
import type { RadarItem, RadarResponse } from "../../../types";
import { getPragueTodayISO, startOfWeek } from "../../../shared/state/page-state";
import { RadarCard, RadarMini, RadarReleaseCell } from "./RadarCards";
import {
  formatRadarDate,
  formatShortDate,
  formatWeekRange,
  formatWeekday,
  getWeekDays,
} from "../../../shared/lib/view-helpers";
export function RadarWeeklySchedule({
  data,
  items,
  selectedDay,
  preparing,
  onNavigate,
  onDayChange,
  onPrepareWeek,
  onSelectProgramFilm,
}: {
  data: RadarResponse;
  items: RadarItem[];
  selectedDay: string | null;
  preparing: boolean;
  onNavigate: (week: string) => void;
  onDayChange: (day: string) => void;
  onPrepareWeek: () => void;
  onSelectProgramFilm: (id: string) => void;
}) {
  const start = data.period.weekStart ?? data.period.start;
  const end = data.period.weekEnd ?? data.period.end;
  const days = getWeekDays(start);
  const today = getPragueTodayISO();
  const activeDay =
    selectedDay && days.includes(selectedDay) ? selectedDay : days[0];

  return (
    <section
      className="weekly-program radar-weekly-program"
      aria-labelledby="radar-week-title"
    >
      <div className="week-toolbar">
        <button
          className="week-nav-button"
          type="button"
          onClick={() =>
            data.period.previousWeekStart &&
            onNavigate(data.period.previousWeekStart)
          }
          aria-label="Předchozí týden"
          title="Předchozí týden"
        >
          <ChevronLeft size={24} aria-hidden="true" />
        </button>
        <div>
          <span className="week-toolbar-label">Premiéry na týden</span>
          <h2 id="radar-week-title">{formatWeekRange(start, end)}</h2>
        </div>
        <button
          className="week-nav-button"
          type="button"
          onClick={() =>
            data.period.nextWeekStart && onNavigate(data.period.nextWeekStart)
          }
          aria-label="Další týden"
          title="Další týden"
        >
          <ChevronRight size={24} aria-hidden="true" />
        </button>
      </div>
      {data.status === "missing" ? (
        <div className={preparing ? "weekly-empty-loading" : "empty-box weekly-empty"}>
          {!preparing ? <p>{data.detail ?? "Radar pro tento týden zatím není připravený."}</p> : null}
          {preparing ? (
            <RadarWeeklyLoadingContent days={days} />
          ) : (
            <button className="inline-action-button" type="button" onClick={onPrepareWeek}>
              Načíst tento týden
            </button>
          )}
        </div>
      ) : items.length ? (
        <>
          <div className="weekly-desktop">
            <RadarWeeklyTable
              items={items}
              days={days}
              today={today}
              onSelectProgramFilm={onSelectProgramFilm}
            />
          </div>
          <div className="weekly-mobile">
            <RadarMobileWeek
              items={items}
              days={days}
              today={today}
              onSelectProgramFilm={onSelectProgramFilm}
            />
          </div>
        </>
      ) : (
        <div className="empty-box weekly-empty">
          V tomto týdnu nejsou premiéry odpovídající výběru.
        </div>
      )}
    </section>
  );
}

function RadarWeeklyTable({
  items,
  days,
  today,
  onSelectProgramFilm,
}: {
  items: RadarItem[];
  days: string[];
  today: string;
  onSelectProgramFilm: (id: string) => void;
}) {
  return (
    <div
      className="weekly-table-scroll"
      role="region"
      aria-label="Týdenní radar premiér"
      tabIndex={0}
    >
      <table className="weekly-table radar-weekly-table">
        <thead>
          <tr>
            <th className="weekly-film-heading" scope="col">
              Film / seriál
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
          {items.map(item => (
            <tr
              className={`radar-week-row radar-${item.mediaType}`}
              key={item.id}
            >
              <th className="weekly-film-cell" scope="row">
                <RadarMini
                  item={item}
                  onSelectProgramFilm={onSelectProgramFilm}
                />
              </th>
              {days.map(day => (
                <td
                  key={day}
                  aria-label={
                    item.releaseDate === day
                      ? `${item.title}: premiéra`
                      : `${item.title}: bez premiéry`
                  }
                >
                  <div className="weekly-times">
                    {item.releaseDate === day ? (
                      <RadarReleaseCell
                        item={item}
                        onSelectProgramFilm={onSelectProgramFilm}
                      />
                    ) : null}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RadarMobileWeek({
  items,
  days,
  today,
  onSelectProgramFilm,
}: {
  items: RadarItem[];
  days: string[];
  today: string;
  onSelectProgramFilm: (id: string) => void;
}) {
  return (
    <div className="mobile-week mobile-week-agenda">
      {days.map(day => {
        const dayItems = items.filter(item => item.releaseDate === day);
        return (
          <section
            className={[
              "mobile-agenda-day",
              "mobile-agenda-radar-day",
              day === today ? "today" : "",
              dayItems.length === 0 ? "empty" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-labelledby={`radar-mobile-day-${day}`}
            key={day}
          >
            <MobileAgendaHeader
              id={`radar-mobile-day-${day}`}
              day={day}
              today={today}
            />
            {dayItems.length ? (
              <div className="radar-list radar-mobile-day-list">
                {dayItems.map((item, index) => (
                  <RadarCard
                    item={item}
                    priority={index === 0}
                    onSelectProgramFilm={onSelectProgramFilm}
                    showDate={false}
                    compactProviders
                    key={item.id}
                  />
                ))}
              </div>
            ) : (
              <div className="mobile-agenda-empty">Bez premiér.</div>
            )}
          </section>
        );
      })}
    </div>
  );

}

export function MobileAgendaHeader({
  id,
  day,
  today,
}: {
  id: string;
  day: string;
  today: string;
}) {
  return (
    <header className="mobile-agenda-day-header">
      <div className="mobile-agenda-date">
        <span>{formatWeekday(day)}</span>
        <strong id={id}>{formatShortDate(day)}</strong>
      </div>
      <div className="mobile-agenda-summary">
        {day === today ? <span className="mobile-agenda-today">Dnes</span> : null}
      </div>
    </header>
  );
}

function RadarLoading() {
  return (
    <div className="radar-list" aria-label="Načítání radaru">
      {Array.from({ length: 5 }).map((_, index) => (
        <div className="radar-card radar-loading" key={index}>
          <div className="radar-poster skeleton" />
          <div className="radar-copy">
            <div className="skeleton-line wide" />
            <div className="skeleton-line short" />
            <div className="skeleton-line" />
            <div className="skeleton-line wide" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function RadarWeeklyLoading({ weekStart }: { weekStart: string | null }) {
  const start = weekStart ?? startOfWeek(getPragueTodayISO());
  const days = getWeekDays(start);

  return (
    <section
      className="weekly-program radar-weekly-program"
      aria-label="Načítání týdenního radaru"
      aria-busy="true"
    >
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
          <span className="week-toolbar-label">Premiéry na týden</span>
          <h2>{formatWeekRange(start, days[6])}</h2>
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
      <RadarWeeklyLoadingContent days={days} />
    </section>
  );
}

function RadarWeeklyLoadingContent({ days }: { days: string[] }) {
  return (
    <>
      <div className="weekly-desktop">
        <div className="weekly-table-scroll">
          <WeeklySkeletonTable days={days} heading="Film / seriál" />
        </div>
      </div>
      <div className="weekly-mobile">
        <MobileAgendaSkeleton days={days} />
        <div
          className="mobile-day-tabs"
          hidden
          role="tablist"
          aria-label="Načítání dnů v týdnu"
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
          <RadarLoading />
        </div>
      </div>
    </>
  );
}

export function MobileAgendaSkeleton({ days }: { days: string[] }) {
  return (
    <div className="mobile-week mobile-week-agenda" aria-hidden="true">
      {days.map((day, index) => (
        <section className="mobile-agenda-day mobile-agenda-skeleton" key={day}>
          <header className="mobile-agenda-day-header">
            <div className="mobile-agenda-date">
              <span className="skeleton day-name-skeleton" />
              <strong className="skeleton day-date-skeleton" />
            </div>
          </header>
          {index % 2 === 0 ? (
            <div className="mobile-program-item mobile-program-skeleton">
              <span className="weekly-poster skeleton" />
              <span className="radar-week-skeleton-copy">
                <span className="skeleton-line wide" />
                <span className="skeleton-line short" />
              </span>
            </div>
          ) : (
            <div className="mobile-agenda-empty skeleton" />
          )}
        </section>
      ))}
    </div>
  );
}

export function WeeklySkeletonTable({ days, heading }: { days: string[]; heading: string }) {
  return (
    <table className="weekly-table radar-weekly-skeleton-table">
      <thead>
        <tr>
          <th className="weekly-film-heading" scope="col">
            {heading}
          </th>
          {days.map(day => (
            <th scope="col" key={day}>
              <span>{formatWeekday(day)}</span>
              <strong>{formatShortDate(day)}</strong>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: 4 }).map((_, row) => (
          <tr key={row}>
            <th className="weekly-film-cell" scope="row">
              <div className="weekly-film-summary">
                <span className="weekly-poster skeleton" />
                <span className="radar-week-skeleton-copy">
                  <span className="skeleton-line wide" />
                  <span className="skeleton-line short" />
                </span>
              </div>
            </th>
            {days.map((day, column) => (
              <td key={day}>
                <div className="weekly-times">
                  {column === (row * 2 + 1) % 7 ||
                  (row === 2 && column === 5) ? (
                    <span className="radar-release-skeleton skeleton" />
                  ) : null}
                </div>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}





