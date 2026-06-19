import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Download,
  Search,
  X
} from "lucide-react";
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

type ViewMode = "week" | "all";

type ScheduleResponse = {
  fetchedAt: string;
  totals: { films: number; screenings: number; withSubtitles: number };
  period: {
    mode: ViewMode;
    weekStart: string | null;
    weekEnd: string | null;
    previousWeekStart: string | null;
    nextWeekStart: string | null;
  };
  films: FilmGroup[];
};

type PageState = {
  view: ViewMode;
  week: string | null;
  day: string | null;
  query: string;
  subtitles: boolean;
};

type LoadState =
  | { status: "loading"; data: ScheduleResponse | null; error: null }
  | { status: "ready"; data: ScheduleResponse; error: null }
  | { status: "error"; data: ScheduleResponse | null; error: string };

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function App() {
  const [page, setPage] = useState<PageState>(readPageState);
  const [load, setLoad] = useState<LoadState>({ status: "loading", data: null, error: null });
  const [offline, setOffline] = useState(!navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [pendingFilmScroll, setPendingFilmScroll] = useState<string | null>(null);

  useEffect(() => {
    const onPopState = () => setPage(readPageState());
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
    const controller = new AbortController();

    async function loadSchedule() {
      setLoad({ status: "loading", data: null, error: null });

      try {
        const query = page.view === "week" ? `?view=week${page.week ? `&week=${encodeURIComponent(page.week)}` : ""}` : "";
        const response = await fetch(`/api/schedule${query}`, { signal: controller.signal });
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.detail || body.error || "Program se nepodařilo načíst.");
        }

        setOffline(response.headers.get("x-nzfd-offline") === "1" || !navigator.onLine);
        setLoad({ status: "ready", data: body, error: null });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoad((current) => ({
          status: "error",
          data: current.data,
          error: error instanceof Error ? error.message : "Program se nepodařilo načíst."
        }));
      }
    }

    void loadSchedule();
    return () => controller.abort();
  }, [page.view, page.week]);

  useEffect(() => {
    if (page.view !== "week" || !load.data?.period.weekStart || !load.data.period.weekEnd) return;
    const days = getWeekDays(load.data.period.weekStart);
    if (page.day && days.includes(page.day)) return;

    const today = getPragueTodayISO();
    const nextDay = days.includes(today)
      ? today
      : days.find((day) => load.data!.films.some((film) => film.screenings.some((screening) => screening.dateISO === day))) ?? days[0];
    changePage({ day: nextDay }, "replace");
  }, [load.data, page.day, page.view]);

  useEffect(() => {
    try {
      sessionStorage.setItem("nzfd-view-mode", page.view);
    } catch {
      // View preference remains optional when browser storage is unavailable.
    }
  }, [page.view]);

  useEffect(() => {
    if (!pendingFilmScroll || page.view !== "all" || load.status !== "ready") return;
    const animationFrame = window.requestAnimationFrame(() => {
      document.getElementById(pendingFilmScroll)?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start"
      });
      setPendingFilmScroll(null);
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [load.status, page.view, pendingFilmScroll]);

  const filteredFilms = useMemo(() => {
    if (!load.data) return [];
    const normalizedQuery = page.query.trim().toLocaleLowerCase("cs-CZ");

    return load.data.films
      .filter((film) => !normalizedQuery || film.title.toLocaleLowerCase("cs-CZ").includes(normalizedQuery))
      .map((film) => ({
        ...film,
        screenings: film.screenings.filter((screening) => {
          if (page.subtitles && !screening.hasSubtitles) return false;
          return true;
        })
      }))
      .filter((film) => film.screenings.length > 0);
  }, [load.data, page.query, page.subtitles]);

  const filtersActive = Boolean(page.query || page.subtitles);

  function changePage(patch: Partial<PageState>, mode: "push" | "replace" = "push") {
    setPage((current) => {
      const next = { ...current, ...patch };
      writePageState(next, mode);
      return next;
    });
  }

  function changeView(view: ViewMode) {
    if (view === page.view) return;
    changePage({ view, week: null, day: null });
  }

  function showFilmInAll(id: string) {
    setPendingFilmScroll(id);
    changePage({ view: "all", week: null, day: null, query: "", subtitles: false });
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  return (
    <main className="app-shell">
      <header className="topbar topbar-standalone">
        <div className="brand-block"><img className="app-wordmark" src="/nzfd-wordmark.png" alt="NZFD" width="430" height="48" fetchPriority="high" /></div>
        <div className="topbar-actions">
          {installPrompt ? (
            <button className="header-icon-button" type="button" onClick={() => void installApp()} title="Nainstalovat aplikaci" aria-label="Nainstalovat aplikaci">
              <Download size={19} />
            </button>
          ) : null}
          <div className="view-switch" role="group" aria-label="Zobrazení programu">
            <button className={page.view === "week" ? "view-switch-button active" : "view-switch-button"} type="button" aria-pressed={page.view === "week"} onClick={() => changeView("week")}>Týden</button>
            <button className={page.view === "all" ? "view-switch-button active" : "view-switch-button"} type="button" aria-pressed={page.view === "all"} onClick={() => changeView("all")}>Vše</button>
          </div>
        </div>
      </header>

      {page.view === "all" ? (
        <FilterToolbar page={page} onChange={changePage} />
      ) : null}

      {offline && load.data ? (
        <div className="offline-banner" role="status">Offline program, poslední data z {formatFetchedAt(load.data.fetchedAt)}.</div>
      ) : null}
      {load.status === "error" ? <div className="error-box">{load.error}</div> : null}

      {load.status === "loading" && !load.data ? (
        page.view === "week" ? <WeeklyLoading weekStart={page.week} /> : <LoadingRows />
      ) : load.data && page.view === "week" ? (
        <WeeklySchedule
          data={load.data}
          films={filteredFilms}
          selectedDay={page.day}
          onNavigate={(week) => changePage({ week, day: null })}
          onDayChange={(day) => changePage({ day })}
          onSelectFilm={showFilmInAll}
        />
      ) : load.data && filteredFilms.length > 0 ? (
        <section className="program-list" aria-label="Program filmů">
          {filteredFilms.map((film, index) => (
            <FilmRow film={film} priority={index === 0} key={film.id} />
          ))}
        </section>
      ) : load.data ? (
        <div className="empty-box">{filtersActive ? "Žádná projekce neodpovídá vybraným filtrům." : "Momentálně tu není žádný program kina."}</div>
      ) : null}
    </main>
  );
}

function FilterToolbar({ page, onChange }: {
  page: PageState;
  onChange: (patch: Partial<PageState>, mode?: "push" | "replace") => void;
}) {
  return (
    <section className="filter-toolbar" aria-label="Filtrování programu">
      <label className="search-field">
        <Search size={18} aria-hidden="true" />
        <span className="sr-only">Hledat film</span>
        <input value={page.query} onChange={(event) => onChange({ query: event.target.value }, "replace")} placeholder="Hledat film" type="search" />
        {page.query ? (
          <button className="search-clear-button" type="button" onClick={() => onChange({ query: "" }, "replace")} aria-label="Vymazat hledání" title="Vymazat hledání">
            <X size={16} />
          </button>
        ) : null}
      </label>

      <button className={page.subtitles ? "filter-button active" : "filter-button"} type="button" aria-pressed={page.subtitles} onClick={() => onChange({ subtitles: !page.subtitles })}>Titulky</button>

    </section>
  );
}

function WeeklySchedule({ data, films, selectedDay, onNavigate, onDayChange, onSelectFilm }: {
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
  const activeDay = selectedDay && days.includes(selectedDay) ? selectedDay : days[0];

  return (
    <section className="weekly-program" aria-labelledby="weekly-program-title">
      <div className="week-toolbar">
        <button className="week-nav-button" type="button" disabled={!period.previousWeekStart} onClick={() => period.previousWeekStart && onNavigate(period.previousWeekStart)} aria-label="Předchozí týden s programem" title="Předchozí týden"><span aria-hidden="true">‹</span></button>
        <div><span className="week-toolbar-label">Program na týden</span><h2 id="weekly-program-title">{formatWeekRange(period.weekStart, period.weekEnd)}</h2></div>
        <button className="week-nav-button" type="button" disabled={!period.nextWeekStart} onClick={() => period.nextWeekStart && onNavigate(period.nextWeekStart)} aria-label="Další týden s programem" title="Další týden"><span aria-hidden="true">›</span></button>
      </div>

      {films.length > 0 ? (
        <>
          <div className="weekly-desktop"><WeeklyTable films={films} days={days} today={today} onSelectFilm={onSelectFilm} /></div>
          <div className="weekly-mobile"><MobileWeek films={films} days={days} today={today} activeDay={activeDay} onDayChange={onDayChange} onSelectFilm={onSelectFilm} /></div>
        </>
      ) : <div className="empty-box weekly-empty">V tomto týdnu nejsou projekce odpovídající vybraným filtrům.</div>}
    </section>
  );
}

function WeeklyTable({ films, days, today, onSelectFilm }: { films: FilmGroup[]; days: string[]; today: string; onSelectFilm: (id: string) => void }) {
  return (
    <div className="weekly-table-scroll" role="region" aria-label="Týdenní program" tabIndex={0}>
      <table className="weekly-table">
        <thead><tr><th className="weekly-film-heading" scope="col">Film</th>{days.map((day) => <th className={day === today ? "weekly-today" : undefined} scope="col" key={day} aria-current={day === today ? "date" : undefined}><span>{formatWeekday(day)}</span><strong>{formatShortDate(day)}</strong></th>)}</tr></thead>
        <tbody>{films.map((film) => (
          <tr key={film.id}>
            <th className="weekly-film-cell" scope="row"><FilmMini film={film} onSelectFilm={onSelectFilm} /></th>
            {days.map((day) => {
              const screenings = film.screenings.filter((screening) => screening.dateISO === day);
              return <td className={day === today ? "weekly-today" : undefined} key={day} aria-label={screenings.length === 0 ? `${film.title}: bez projekce` : undefined}><div className="weekly-times">{screenings.map((screening) => <CompactScreening film={film} screening={screening} key={screening.id} />)}</div></td>;
            })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function MobileWeek({ films, days, today, activeDay, onDayChange, onSelectFilm }: { films: FilmGroup[]; days: string[]; today: string; activeDay: string; onDayChange: (day: string) => void; onSelectFilm: (id: string) => void }) {
  const dayFilms = films.map((film) => ({ ...film, screenings: film.screenings.filter((screening) => screening.dateISO === activeDay) })).filter((film) => film.screenings.length > 0);

  return (
    <div className="mobile-week">
      <div className="mobile-day-tabs" role="tablist" aria-label="Dny v týdnu">
        {days.map((day) => {
          const count = films.reduce((sum, film) => sum + film.screenings.filter((screening) => screening.dateISO === day).length, 0);
          const classes = [day === activeDay ? "active" : "", day === today ? "today" : "", count === 0 ? "empty" : ""].filter(Boolean).join(" ");
          return <button className={classes} type="button" role="tab" aria-selected={day === activeDay} aria-label={`${formatWeekday(day)} ${formatShortDate(day)}${count === 0 ? ", bez projekce" : ""}`} onClick={() => onDayChange(day)} key={day}><span>{formatWeekday(day)}</span><strong>{formatShortDate(day)}</strong></button>;
        })}
      </div>
      <div className="mobile-day-program" role="tabpanel">
        {dayFilms.length ? dayFilms.map((film, index) => <FilmRow film={film} priority={index === 0} onSelectFilm={onSelectFilm} key={film.id} />) : <div className="empty-box mobile-day-empty">V tento den není žádná projekce.</div>}
      </div>
    </div>
  );
}

function FilmMini({ film, onSelectFilm }: { film: FilmGroup; onSelectFilm: (id: string) => void }) {
  return (
    <div className="weekly-film-summary">
      <Poster film={film} variant="mini" />
      <div className="weekly-film-copy"><button className="weekly-film-title-button" type="button" onClick={() => onSelectFilm(film.id)}>{film.title}</button><div className="weekly-film-meta">{film.csfd?.rating != null ? film.csfd.url ? <a className={`weekly-rating ${getRatingClass(film.csfd.rating)}`} href={film.csfd.url} target="_blank" rel="noopener noreferrer" aria-label={`${film.title} na ČSFD, hodnocení ${film.csfd.rating} %`}>{film.csfd.rating}%</a> : <span className={`weekly-rating ${getRatingClass(film.csfd.rating)}`}>{film.csfd.rating}%</span> : film.csfd?.url ? <a className="weekly-rating rating-missing" href={film.csfd.url} target="_blank" rel="noopener noreferrer" aria-label={`${film.title} na ČSFD, zatím bez hodnocení`}>?</a> : null}{film.hasSubtitles ? <span className="weekly-subtitle-mark">Titulky</span> : null}</div></div>
    </div>
  );
}

function FilmRow({ film, priority, onSelectFilm }: { film: FilmGroup; priority: boolean; onSelectFilm?: (id: string) => void }) {
  return (
    <article className={film.hasSubtitles ? "film-row film-row-subtitles" : "film-row"} id={film.id}>
      <div className="film-info">
        <div className="poster-column"><Poster film={film} priority={priority} /></div>
        <div className="film-copy">
          <div className="title-line"><h2>{onSelectFilm ? <button className="film-title-button" type="button" onClick={() => onSelectFilm(film.id)}>{film.title}</button> : film.title}</h2>{film.hasSubtitles ? <span className="subtitle-mark">Titulky</span> : null}</div>
          <p>{film.description}</p>
          <div className="csfd-block"><div className="csfd-line">{film.csfd?.rating != null ? film.csfd.url ? <a className={`rating-badge rating-link ${getRatingClass(film.csfd.rating)}`} href={film.csfd.url} target="_blank" rel="noopener noreferrer" aria-label={`${film.title} na ČSFD, hodnocení ${film.csfd.rating} %`}>{film.csfd.rating}%</a> : <span className={`rating-badge ${getRatingClass(film.csfd.rating)}`}>{film.csfd.rating}%</span> : film.csfd?.url ? <a className="rating-badge rating-link rating-missing" href={film.csfd.url} target="_blank" rel="noopener noreferrer" aria-label={`${film.title} na ČSFD, zatím bez hodnocení`}>?</a> : <span className="rating-badge rating-missing">?</span>}<span className="rating-copy">{getCsfdStatusText(film.csfd)}</span></div></div>
        </div>
      </div>
      <div className="screening-grid">{film.screenings.map((screening) => <ScreeningCard film={film} screening={screening} key={screening.id} />)}</div>
    </article>
  );
}

function Poster({ film, variant = "full", priority = false }: { film: FilmGroup; variant?: "full" | "mini"; priority?: boolean }) {
  if (!film.posterUrl) return variant === "mini" ? <div className="weekly-poster"><span>Film</span></div> : <div className="poster-frame"><div className="poster-fallback">Film</div></div>;
  const sources = getPosterSources(film.posterUrl);
  const className = variant === "mini" ? "weekly-poster" : "poster-frame";
  return <div className={className}><img src={sources.medium} srcSet={`${sources.small} 180w, ${sources.medium} 360w`} sizes={variant === "mini" ? "48px" : "(max-width: 720px) 88px, 106px"} width={variant === "mini" ? 48 : 106} height={variant === "mini" ? 72 : 159} alt="" loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} onError={(event) => { const image = event.currentTarget; if (!image.dataset.fallback) { image.dataset.fallback = "1"; image.srcset = ""; image.src = sources.original; } }} /></div>;
}

function ScreeningCard({ film, screening }: { film: FilmGroup; screening: Screening }) {
  const targetUrl = screening.ticketUrl ?? screening.fidikoUrl;
  return (
    <a className={screening.hasSubtitles ? "screening-button screening-subtitles" : "screening-button"} href={targetUrl} target="_blank" rel="noopener noreferrer" aria-label={`${film.title}, ${screening.dateLabel}, ${screening.time ?? "detail"}${screening.ticketUrl ? ", vstupenky" : ""}`}>
      <span className="screening-date">{screening.dateLabel}</span><span className="screening-time">{screening.time ?? screening.weekday ?? "Detail"}</span>{screening.weekday && screening.time ? <span className="screening-weekday">{screening.weekday}</span> : null}
      <span className="format-row">{screening.formats.length ? screening.formats.map((format) => <span className={format === "Titulky" ? "format-badge format-subtitles" : "format-badge"} key={format}>{format}</span>) : <span className="format-badge format-muted">Info</span>}</span>
    </a>
  );
}

function CompactScreening({ film, screening }: { film: FilmGroup; screening: Screening }) {
  const targetUrl = screening.ticketUrl ?? screening.fidikoUrl;
  return <a className={screening.hasSubtitles ? "weekly-screening has-subtitles" : "weekly-screening"} href={targetUrl} target="_blank" rel="noopener noreferrer" aria-label={`${film.title}, ${screening.time ?? "detail"}${screening.ticketUrl ? ", vstupenky" : ""}`}><strong>{screening.time ?? "Detail"}</strong><span>{screening.formats.join(" / ") || "Info"}</span></a>;
}

function WeeklyLoading({ weekStart }: { weekStart: string | null }) {
  const start = weekStart ?? startOfWeek(getPragueTodayISO());
  const days = getWeekDays(start);
  const end = days[6];

  return (
    <section className="weekly-program" aria-label="Načítání týdenního programu">
      <div className="week-toolbar">
        <button className="week-nav-button" type="button" disabled aria-label="Předchozí týden"><span aria-hidden="true">‹</span></button>
        <div><span className="week-toolbar-label">Program na týden</span><h2>{formatWeekRange(start, end)}</h2></div>
        <button className="week-nav-button" type="button" disabled aria-label="Další týden"><span aria-hidden="true">›</span></button>
      </div>
      <div className="weekly-desktop"><div className="weekly-table-scroll"><div className="weekly-table-skeleton skeleton" /></div></div>
      <div className="weekly-mobile">
        <div className="mobile-day-tabs" role="tablist" aria-label="Dny v týdnu">
          {days.map((day) => <button className="day-tab-skeleton" type="button" role="tab" aria-label="Načítání dne" disabled key={day}><span className="skeleton day-name-skeleton" /><span className="skeleton day-date-skeleton" /></button>)}
        </div>
        <div className="mobile-day-program"><LoadingRows /></div>
      </div>
    </section>
  );
}

function LoadingRows() {
  return <section className="program-list" aria-label="Načítání programu">{Array.from({ length: 4 }).map((_, index) => <div className="film-row loading-row" key={index}><div className="film-info"><div className="poster-frame skeleton" /><div className="film-copy"><div className="skeleton-line wide" /><div className="skeleton-line" /><div className="skeleton-line short" /></div></div><div className="screening-grid"><div className="screening-button skeleton-button" /><div className="screening-button skeleton-button" /><div className="screening-button skeleton-button" /></div></div>)}</section>;
}

function readPageState(): PageState {
  const params = new URLSearchParams(window.location.search);
  const storedView = readStoredViewMode();
  const view = params.get("view") === "week" || params.get("view") === "all" ? params.get("view") as ViewMode : storedView;
  return { view, week: validISODate(params.get("week")), day: validISODate(params.get("day")), query: params.get("q") ?? "", subtitles: params.get("subtitles") === "1" };
}

function writePageState(page: PageState, mode: "push" | "replace") {
  const params = new URLSearchParams();
  params.set("view", page.view);
  if (page.view === "week" && page.week) params.set("week", page.week);
  if (page.view === "week" && page.day) params.set("day", page.day);
  if (page.query) params.set("q", page.query);
  if (page.subtitles) params.set("subtitles", "1");
  const url = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  window.history[mode === "push" ? "pushState" : "replaceState"](null, "", url);
}

function readStoredViewMode(): ViewMode {
  try {
    localStorage.removeItem("nzfd-view-mode");
  } catch {
    // Ignore unavailable persistent storage while migrating the old preference.
  }

  try {
    const stored = sessionStorage.getItem("nzfd-view-mode");
    return stored === "all" || stored === "week" ? stored : "week";
  } catch {
    return "week";
  }
}

function validISODate(value: string | null) { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null; }

function getPosterSources(url: string) {
  const replaceWidth = (width: number) => url.replace(/\/cache\/resized\/w\d+\//, `/cache/resized/w${width}/`);
  return { small: replaceWidth(180), medium: replaceWidth(360), original: replaceWidth(1080) };
}

function getCsfdStatusText(csfd: CsfdMatch | null) {
  if (!csfd?.url) return "ČSFD nenalezeno";
  if (csfd.ratingCount) return `${csfd.ratingCount.toLocaleString("cs-CZ")} hodnocení`;
  return "Bez hodnocení";
}

function getRatingClass(rating: number) { return rating >= 70 ? "rating-good" : rating >= 30 ? "rating-average" : "rating-bad"; }

function getPragueTodayISO() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getWeekDays(weekStart: string) { return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)); }
function startOfWeek(value: string) { const date = new Date(`${value}T00:00:00.000Z`); const day = date.getUTCDay(); date.setUTCDate(date.getUTCDate() + (day === 0 ? -6 : 1 - day)); return date.toISOString().slice(0, 10); }
function addDays(value: string, days: number) { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function formatWeekday(value: string) { return new Intl.DateTimeFormat("cs-CZ", { weekday: "short", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`)).replace(".", ""); }
function formatShortDate(value: string) { return new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`)); }

function formatWeekRange(start: string | null, end: string | null) {
  if (!start || !end) return "Aktuální týden";
  const formatter = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "long", year: start.slice(0, 4) === end.slice(0, 4) ? undefined : "numeric", timeZone: "UTC" });
  const endFormatter = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return `${formatter.format(new Date(`${start}T00:00:00.000Z`))} - ${endFormatter.format(new Date(`${end}T00:00:00.000Z`))}`;
}

function formatFetchedAt(value: string) { return new Intl.DateTimeFormat("cs-CZ", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Prague" }).format(new Date(value)); }

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => { void navigator.serviceWorker.register("/sw.js"); });
}
