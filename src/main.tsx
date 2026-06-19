import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Screening = {
  id: string;
  title: string;
  fidikoUrl: string;
  ticketUrl: string | null;
  posterUrl: string | null;
  dateText: string;
  dateLabel: string;
  dateISO: string;
  weekday: string | null;
  time: string | null;
  description: string;
  formats: string[];
  hasSubtitles: boolean;
};

type CsfdMatch = {
  title: string;
  rating: number | null;
  ratingCount: number | null;
  url: string | null;
  poster: string | null;
};

type FilmGroup = {
  id: string;
  title: string;
  posterUrl: string | null;
  description: string;
  hasSubtitles: boolean;
  csfd: CsfdMatch | null;
  screenings: Screening[];
};

type ScheduleResponse = {
  fetchedAt: string;
  totals: {
    films: number;
    screenings: number;
    withSubtitles: number;
  };
  period: {
    mode: ViewMode;
    weekStart: string | null;
    weekEnd: string | null;
    previousWeekStart: string | null;
    nextWeekStart: string | null;
  };
  films: FilmGroup[];
};

type ViewMode = "week" | "all";

type LoadState =
  | { status: "loading"; data: ScheduleResponse | null; error: null }
  | { status: "ready"; data: ScheduleResponse; error: null }
  | { status: "error"; data: ScheduleResponse | null; error: string };

function App() {
  const [state, setState] = useState<LoadState>({ status: "loading", data: null, error: null });
  const [viewMode, setViewMode] = useState<ViewMode>(readStoredViewMode);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const isLoading = state.status === "loading";

  useEffect(() => {
    const controller = new AbortController();

    async function loadSchedule() {
      setState((current) => ({ status: "loading", data: current.data, error: null }));

      try {
        const query =
          viewMode === "week"
            ? `?view=week${selectedWeek ? `&week=${encodeURIComponent(selectedWeek)}` : ""}`
            : "";
        const response = await fetch(`/api/schedule${query}`, { signal: controller.signal });
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.detail || body.error || "Program se nepodařilo načíst.");
        }

        setState({ status: "ready", data: body, error: null });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setState((current) => ({
          status: "error",
          data: current.data,
          error: error instanceof Error ? error.message : "Program se nepodařilo načíst."
        }));
      }
    }

    void loadSchedule();
    return () => controller.abort();
  }, [selectedWeek, viewMode]);

  const changeView = (nextView: ViewMode) => {
    if (nextView === viewMode) {
      return;
    }

    try {
      localStorage.setItem("nzfd-view-mode", nextView);
    } catch {
      // The preference is optional when browser storage is unavailable.
    }

    setSelectedWeek(null);
    setViewMode(nextView);
  };

  const subtitleFilms = useMemo(
    () => state.data?.films.filter((film) => film.hasSubtitles).slice(0, 4) ?? [],
    [state.data]
  );

  return (
    <main className="app-shell">
      <header className={viewMode === "week" ? "topbar topbar-standalone" : "topbar"}>
        <div className="brand-block">
          <img className="app-wordmark" src="/nzfd-wordmark.png" alt="NŽFD" />
        </div>
        <div className="view-switch" role="group" aria-label="Zobrazení programu">
          <button
            className={viewMode === "week" ? "view-switch-button active" : "view-switch-button"}
            type="button"
            aria-pressed={viewMode === "week"}
            onClick={() => changeView("week")}
          >
            Týden
          </button>
          <button
            className={viewMode === "all" ? "view-switch-button active" : "view-switch-button"}
            type="button"
            aria-pressed={viewMode === "all"}
            onClick={() => changeView("all")}
          >
            Vše
          </button>
        </div>
      </header>

      {viewMode === "all" ? (
        <section className="status-strip" aria-label="Souhrn programu">
          <Metric label="Filmy" value={state.data?.totals.films ?? "?"} />
          <Metric label="Promítání" value={state.data?.totals.screenings ?? "?"} />
          <Metric label="S titulky" value={state.data?.totals.withSubtitles ?? "?"} accent />
        </section>
      ) : null}

      {state.status === "error" ? <div className="error-box">{state.error}</div> : null}

      {isLoading ? (
        viewMode === "week" ? <WeeklyLoading /> : <LoadingRows />
      ) : state.data && viewMode === "week" ? (
        <WeeklySchedule data={state.data} onNavigate={setSelectedWeek} />
      ) : state.data && state.data.films.length > 0 ? (
        <>
          <SubtitleSummary films={subtitleFilms} />
          <section className="program-list" aria-label="Program filmů">
            {state.data.films.map((film) => (
              <FilmRow film={film} key={film.id} />
            ))}
          </section>
        </>
      ) : (
        <div className="empty-box">Momentálně tu není žádný program kina.</div>
      )}
    </main>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className={accent ? "metric metric-accent" : "metric"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WeeklySchedule({ data, onNavigate }: { data: ScheduleResponse; onNavigate: (week: string) => void }) {
  const { period } = data;
  const days = period.weekStart ? getWeekDays(period.weekStart) : [];
  const today = getPragueTodayISO();

  return (
    <section className="weekly-program" aria-labelledby="weekly-program-title">
      <div className="week-toolbar">
        <button
          className="week-nav-button"
          type="button"
          disabled={!period.previousWeekStart}
          onClick={() => period.previousWeekStart && onNavigate(period.previousWeekStart)}
          aria-label="Předchozí týden s programem"
          title="Předchozí týden"
        >
          <span aria-hidden="true">‹</span>
        </button>
        <div>
          <span className="week-toolbar-label">Program na týden</span>
          <h2 id="weekly-program-title">{formatWeekRange(period.weekStart, period.weekEnd)}</h2>
        </div>
        <button
          className="week-nav-button"
          type="button"
          disabled={!period.nextWeekStart}
          onClick={() => period.nextWeekStart && onNavigate(period.nextWeekStart)}
          aria-label="Další týden s programem"
          title="Další týden"
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>

      {data.films.length > 0 ? (
        <div className="weekly-table-scroll" role="region" aria-label="Týdenní program" tabIndex={0}>
          <table className="weekly-table">
            <thead>
              <tr>
                <th className="weekly-film-heading" scope="col">Film</th>
                {days.map((day) => (
                  <th className={day === today ? "weekly-today" : undefined} scope="col" key={day} aria-current={day === today ? "date" : undefined}>
                    <span>{formatWeekday(day)}</span>
                    <strong>{formatShortDate(day)}</strong>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.films.map((film) => (
                <tr key={film.id}>
                  <th className="weekly-film-cell" scope="row">
                    <div className="weekly-film-summary">
                      <div className="weekly-poster">
                        {film.posterUrl ? <img src={film.posterUrl} alt="" loading="lazy" /> : <span>Film</span>}
                      </div>
                      <div className="weekly-film-copy">
                        <strong>{film.title}</strong>
                        <div className="weekly-film-meta">
                          {film.csfd?.rating !== null && film.csfd?.rating !== undefined ? (
                            film.csfd.url ? (
                              <a
                                className={`weekly-rating ${getRatingClass(film.csfd.rating)}`}
                                href={film.csfd.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`${film.title} na ČSFD, hodnocení ${film.csfd.rating} %`}
                              >
                                {film.csfd.rating}%
                              </a>
                            ) : (
                              <span className={`weekly-rating ${getRatingClass(film.csfd.rating)}`}>{film.csfd.rating}%</span>
                            )
                          ) : null}
                          {film.hasSubtitles ? <span className="weekly-subtitle-mark">Titulky</span> : null}
                        </div>
                      </div>
                    </div>
                  </th>
                  {days.map((day) => {
                    const screenings = film.screenings.filter((screening) => screening.dateISO === day);

                    return (
                      <td
                        className={day === today ? "weekly-today" : undefined}
                        key={day}
                        aria-label={screenings.length === 0 ? `${film.title}: bez projekce` : undefined}
                      >
                        <div className="weekly-times">
                          {screenings.map((screening) => (
                            <WeeklyScreeningLink screening={screening} key={screening.id} />
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
      ) : (
        <div className="empty-box weekly-empty">V tomto týdnu nejsou naplánované žádné projekce.</div>
      )}
    </section>
  );
}

function WeeklyScreeningLink({ screening }: { screening: Screening }) {
  return (
    <a
      className={screening.hasSubtitles ? "weekly-time-link has-subtitles" : "weekly-time-link"}
      href={screening.fidikoUrl}
      target="_blank"
      rel="noreferrer"
      title="Otevřít detail na Fidiko"
    >
      <strong>{screening.time ?? "Detail"}</strong>
      <span>{screening.formats.join(" / ") || "Info"}</span>
    </a>
  );
}

function WeeklyLoading() {
  return (
    <section className="weekly-program" aria-label="Načítání týdenního programu">
      <div className="week-toolbar weekly-toolbar-skeleton">
        <div className="skeleton week-nav-skeleton" />
        <div className="skeleton week-title-skeleton" />
        <div className="skeleton week-nav-skeleton" />
      </div>
      <div className="weekly-table-scroll">
        <div className="weekly-table-skeleton skeleton" />
      </div>
    </section>
  );
}

function SubtitleSummary({ films }: { films: FilmGroup[] }) {
  if (films.length === 0) {
    return null;
  }

  return (
    <section className="subtitle-summary" aria-label="Rychlý přehled titulků">
      <div>
        <span className="section-label">Titulky</span>
        <h2>Nejbližší filmy s titulky</h2>
      </div>
      <div className="subtitle-pills">
        {films.map((film) => (
          <a href={`#${film.id}`} key={film.id}>
            {film.title}
          </a>
        ))}
      </div>
    </section>
  );
}

function FilmRow({ film }: { film: FilmGroup }) {
  return (
    <article className={film.hasSubtitles ? "film-row film-row-subtitles" : "film-row"} id={film.id}>
      <div className="film-info">
        <div className="poster-column">
          <div className="poster-frame">
            {film.posterUrl ? <img src={film.posterUrl} alt="" loading="lazy" /> : <div className="poster-fallback">Film</div>}
          </div>
          {film.csfd?.url ? (
            <a
              className="csfd-button csfd-button-mobile"
              href={film.csfd.url}
              onClick={(event) => openInNewTab(event, film.csfd!.url!)}
              target="_blank"
              rel="noopener noreferrer"
            >
              ČSFD
            </a>
          ) : null}
        </div>
        <div className="film-copy">
          <div className="title-line">
            <h2>{film.title}</h2>
            {film.hasSubtitles ? <span className="subtitle-mark">Titulky</span> : null}
          </div>
          <p>{film.description}</p>
          <div className="csfd-block">
            <div className="csfd-line">
              {film.csfd?.rating !== null && film.csfd?.rating !== undefined ? (
                film.csfd.url ? (
                  <a
                    className={`rating-badge rating-link ${getRatingClass(film.csfd.rating)}`}
                    href={film.csfd.url}
                    onClick={(event) => openInNewTab(event, film.csfd!.url!)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${film.title} na ČSFD, hodnocení ${film.csfd.rating} %`}
                  >
                    {film.csfd.rating}%
                  </a>
                ) : (
                  <span className={`rating-badge ${getRatingClass(film.csfd.rating)}`}>{film.csfd.rating}%</span>
                )
              ) : (
                <span className="rating-badge rating-missing">?</span>
              )}
              <span className="rating-copy">
                {getCsfdStatusText(film.csfd)}
              </span>
              {film.csfd?.url ? (
                <a
                  className="csfd-button csfd-button-desktop"
                  href={film.csfd.url}
                  onClick={(event) => openInNewTab(event, film.csfd!.url!)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ČSFD
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="screening-grid">
        {film.screenings.map((screening) => (
          <ScreeningButton screening={screening} key={screening.id} />
        ))}
      </div>
    </article>
  );
}

function ScreeningButton({ screening }: { screening: Screening }) {
  const targetUrl = screening.fidikoUrl;
  const hasTickets = Boolean(screening.ticketUrl);

  return (
    <a
      className={screening.hasSubtitles ? "screening-button screening-subtitles" : "screening-button"}
      href={targetUrl}
      target="_blank"
      rel="noreferrer"
      title={hasTickets ? "Otevřít detail na Fidiko se vstupenkami" : "Otevřít detail na Fidiko"}
    >
      <span className="screening-date">{screening.dateLabel}</span>
      <span className="screening-time">{screening.time ?? screening.weekday ?? "Detail"}</span>
      {screening.weekday && screening.time ? <span className="screening-weekday">{screening.weekday}</span> : null}
      <span className="format-row">
        {screening.formats.length > 0 ? (
          screening.formats.map((format) => (
            <span className={format === "Titulky" ? "format-badge format-subtitles" : "format-badge"} key={format}>
              {format}
            </span>
          ))
        ) : (
          <span className="format-badge format-muted">{hasTickets ? "Vstupenky" : "Info"}</span>
        )}
      </span>
    </a>
  );
}

function getCsfdStatusText(csfd: CsfdMatch | null) {
  if (!csfd?.url) {
    return "ČSFD nenalezeno";
  }

  if (csfd.ratingCount) {
    return `${csfd.ratingCount.toLocaleString("cs-CZ")} hodnocení`;
  }

  return "Bez hodnocení";
}

function getRatingClass(rating: number) {
  if (rating >= 70) {
    return "rating-good";
  }

  if (rating >= 30) {
    return "rating-average";
  }

  return "rating-bad";
}

function openInNewTab(event: React.MouseEvent<HTMLAnchorElement>, url: string) {
  event.preventDefault();
  window.open(url, "_blank", "noopener,noreferrer");
}

function readStoredViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem("nzfd-view-mode");
    return stored === "all" || stored === "week" ? stored : "all";
  } catch {
    return "all";
  }
}

function getPragueTodayISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

function getWeekDays(weekStart: string) {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatWeekday(value: string) {
  return new Intl.DateTimeFormat("cs-CZ", { weekday: "short", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00.000Z`))
    .replace(".", "");
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00.000Z`)
  );
}

function formatWeekRange(start: string | null, end: string | null) {
  if (!start || !end) {
    return "Aktuální týden";
  }

  const formatter = new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "long",
    year: start.slice(0, 4) === end.slice(0, 4) ? undefined : "numeric",
    timeZone: "UTC"
  });
  const endFormatter = new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });

  return `${formatter.format(new Date(`${start}T00:00:00.000Z`))} - ${endFormatter.format(new Date(`${end}T00:00:00.000Z`))}`;
}

function LoadingRows() {
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
