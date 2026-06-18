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
  films: FilmGroup[];
};

type LoadState =
  | { status: "loading"; data: ScheduleResponse | null; error: null }
  | { status: "ready"; data: ScheduleResponse; error: null }
  | { status: "error"; data: ScheduleResponse | null; error: string };

function App() {
  const [state, setState] = useState<LoadState>({ status: "loading", data: null, error: null });
  const isLoading = state.status === "loading";

  const loadSchedule = async () => {
    setState((current) => ({ status: "loading", data: current.data, error: null }));

    try {
      const response = await fetch("/api/schedule");
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.detail || body.error || "Program se nepodařilo načíst.");
      }

      setState({ status: "ready", data: body, error: null });
    } catch (error) {
      setState((current) => ({
        status: "error",
        data: current.data,
        error: error instanceof Error ? error.message : "Program se nepodařilo načíst."
      }));
    }
  };

  useEffect(() => {
    void loadSchedule();
  }, []);

  const subtitleFilms = useMemo(
    () => state.data?.films.filter((film) => film.hasSubtitles).slice(0, 4) ?? [],
    [state.data]
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <img className="app-wordmark" src="/nzfd-wordmark.png" alt="NŽFD" />
        </div>
      </header>

      <section className="status-strip" aria-label="Souhrn programu">
        <Metric label="Filmy" value={state.data?.totals.films ?? "?"} />
        <Metric label="Promítání" value={state.data?.totals.screenings ?? "?"} />
        <Metric label="S titulky" value={state.data?.totals.withSubtitles ?? "?"} accent />
      </section>

      {state.status === "error" ? <div className="error-box">{state.error}</div> : null}

      {isLoading ? (
        <LoadingRows />
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
        <div className="empty-box">Momentálně tu není žádný program Kina.</div>
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
