import { StrictMode, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { createRoot } from "react-dom/client";
import { Clapperboard, Search, X } from "lucide-react";
import { AppHeader } from "./AppHeader";
import { ProgramView } from "./ProgramView";
import { RadarView } from "./RadarView";
import { fetchJson } from "./api";
import { getPragueTodayISO, readPageState, startOfWeek, storeViewMode, writePageState } from "./page-state";
import { useApiResource } from "./use-api-resource";
import type {
  AppMode,
  CsfdMatch,
  FilmGroup,
  InstallPromptEvent,
  PageState,
  RadarItem,
  RadarProvider,
  RadarProgramMatch,
  RadarResponse,
  ScheduleResponse,
  Screening,
  ViewMode
} from "./types";
import "./styles.css";

const POSTER_PLACEHOLDER_SRC = "/poster-placeholder.png";

function getScheduleUrl(page: PageState) {
  if (page.view !== "week") return "/api/schedule";
  return `/api/schedule?view=week${page.week ? `&week=${encodeURIComponent(page.week)}` : ""}`;
}

function getRadarUrl(page: PageState) {
  return `/api/radar?period=week${page.radarWeek ? `&week=${encodeURIComponent(page.radarWeek)}` : ""}`;
}

function App() {
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
    setRadarPreparing(true);
    try {
      await fetchJson<RadarResponse>(`${getRadarUrl(current)}&refresh=1`);
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
              items={data.items}
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
          renderFilm={(film, index) => <FilmRow film={film} priority={index === 0} key={film.id} />}
        />
      )}
    </main>
  );
}

function RadarWeeklySchedule({
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
          <span aria-hidden="true">‹</span>
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
          <span aria-hidden="true">›</span>
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

function MobileAgendaHeader({
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

function RadarMini({
  item,
  onSelectProgramFilm,
}: {
  item: RadarItem;
  onSelectProgramFilm: (id: string) => void;
}) {
  return (
    <div className="weekly-film-summary">
      <div className="weekly-poster">
        {item.posterUrl ? (
          <img
            {...getRadarPosterProps(item.posterUrl)}
            sizes="48px"
            alt=""
            width="48"
            height="72"
            loading="lazy"
            onError={usePosterPlaceholder}
          />
        ) : (
          <img src={POSTER_PLACEHOLDER_SRC} alt="" width="48" height="72" loading="lazy" />
        )}
      </div>
      <div className="weekly-film-copy">
        {item.program ? (
          <button
            className="weekly-film-title-button"
            type="button"
            onClick={() => onSelectProgramFilm(item.program!.filmId)}
          >
            {formatRadarTitle(item.title)}
          </button>
        ) : (
          <strong>{formatRadarTitle(item.title)}</strong>
        )}
        <p className="weekly-film-description">
          {formatRadarCardMetadata(item, false)}
        </p>
        <div className="weekly-film-meta">
          <RadarMiniRating title={item.title} csfd={item.csfd} />
        </div>
      </div>
    </div>
  );
}

function RadarMiniRating({
  title,
  csfd,
}: {
  title: string;
  csfd: CsfdMatch | null;
}) {
  const className = `weekly-rating ${csfd?.rating == null ? "rating-missing" : getRatingClass(csfd.rating)}`;
  const label =
    csfd?.rating == null
      ? `${title} na ČSFD, zatím bez hodnocení`
      : `${title} na ČSFD, hodnocení ${csfd.rating} %`;
  if (!csfd?.url) {
    return (
      <span className="weekly-rating-block">
        <span className={className} aria-label={label} title={label}>
          ?
        </span>
        <span className="weekly-rating-copy">{getCsfdStatusText(csfd)}</span>
      </span>
    );
  }
  return (
    <span className="weekly-rating-block">
      <a
        className={className}
        href={csfd.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
      >
        {csfd.rating == null ? "?" : `${csfd.rating}%`}
      </a>
      <span className="weekly-rating-copy">{getCsfdStatusText(csfd)}</span>
    </span>
  );
}

function RadarReleaseCell({
  item,
  onSelectProgramFilm,
}: {
  item: RadarItem;
  onSelectProgramFilm: (id: string) => void;
}) {
  if (item.program) {
    return (
      <div className="weekly-time-link radar-release-cell cinema">
        <strong>Kino</strong>
        <span>V programu</span>
        <button
          className="radar-cell-program-button"
          type="button"
          onClick={() => onSelectProgramFilm(item.program!.filmId)}
          aria-label={`${item.title}, otevřít v programu kina`}
          title="Otevřít v programu kina"
        >
          <Clapperboard size={14} aria-hidden="true" />
          <span className="sr-only">V programu</span>
        </button>
      </div>
    );
  }

  return (
    <div className={`weekly-time-link radar-release-cell ${item.channel}`}>
      <strong>{item.channel === "cinema" ? "Kino" : "Streaming"}</strong>
      <span>
        {item.channel === "cinema"
          ? "Premiéra"
          : item.providers.length === 0 && item.csfd?.url
            ? "Více informací na"
            : "Dostupné na"}
      </span>
      {item.channel === "streaming" ? (
        <div className="radar-cell-providers" aria-label="Dostupné služby">
          {item.providers.length === 0 && item.csfd?.url ? (
            <CsfdProviderLink url={item.csfd.url} title={item.title} />
          ) : null}
          {item.providers.map(provider => {
            const label = getProviderLinkLabel(provider, item.title);
            return provider.url ? (
              <a
                href={provider.url}
                target="_blank"
                rel="noopener noreferrer"
                title={label}
                aria-label={label}
                key={provider.id}
              >
                <img src={provider.logoUrl} alt="" width="28" height="28" loading="lazy" />
              </a>
            ) : (
              <span title={provider.name} key={provider.id}>
                <img src={provider.logoUrl} alt="" width="28" height="28" loading="lazy" />
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function RadarCard({
  item,
  priority,
  onSelectProgramFilm,
  showDate = true,
  compactProviders = false,
}: {
  item: RadarItem;
  priority: boolean;
  onSelectProgramFilm: (id: string) => void;
  showDate?: boolean;
  compactProviders?: boolean;
}) {
  const visibleProviders = compactProviders ? item.providers.slice(0, 1) : item.providers;
  return (
    <article className={`radar-card radar-${item.mediaType}`}>
      <div className="radar-poster">
        {item.posterUrl ? (
          <img
            {...getRadarPosterProps(item.posterUrl)}
            sizes="(max-width: 520px) 86px, 114px"
            alt=""
            width="114"
            height="171"
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            onError={usePosterPlaceholder}
          />
        ) : (
          <img src={POSTER_PLACEHOLDER_SRC} alt="" width="114" height="171" loading={priority ? "eager" : "lazy"} />
        )}
      </div>
      <div className="radar-copy">
        <div className="radar-card-head">
          <div>
            <h2>
              {item.program ? (
                <button
                  className="radar-program-title"
                  type="button"
                  onClick={() => onSelectProgramFilm(item.program!.filmId)}
                >
                  {formatRadarTitle(item.title)}
                </button>
              ) : (
                formatRadarTitle(item.title)
              )}
            </h2>
            <p className="radar-card-meta">
              {formatRadarCardMetadata(item, compactProviders)}
            </p>
          </div>
        </div>
        {showDate ? (
          <time dateTime={item.releaseDate}>
            {formatRadarDate(item.releaseDate)}
          </time>
        ) : null}
        <div className="radar-card-footer">
          <div className="radar-meta-row">
            <RadarRating title={item.title} csfd={item.csfd} />
            {item.program ? (
              <button
                className="radar-program-button"
                type="button"
                onClick={() => onSelectProgramFilm(item.program!.filmId)}
                aria-label={`${item.title}, otevřít v programu kina`}
              >
                <Clapperboard size={17} aria-hidden="true" />
                <span>Kino</span>
              </button>
            ) : null}
            {item.channel === "streaming" ? (
              <div className="provider-list" aria-label="Dostupné služby">
                {item.providers.length === 0 && item.csfd?.url ? (
                  <CsfdProviderLink url={item.csfd.url} title={item.title} />
                ) : null}
                {visibleProviders.map(provider => {
                  const href = getProviderHref(provider, compactProviders);
                  const label = getProviderLinkLabel(provider, item.title, compactProviders);
                  return href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={label}
                    aria-label={label}
                    key={provider.id}
                  >
                    <img
                      src={provider.logoUrl}
                      alt=""
                      width="32"
                      height="32"
                      loading="lazy"
                    />
                    <span>{provider.name}</span>
                  </a>
                ) : (
                  <span
                    title={`${provider.name} nemá dostupný přímý odkaz`}
                    key={provider.id}
                  >
                    <img
                      src={provider.logoUrl}
                      alt=""
                      width="32"
                      height="32"
                      loading="lazy"
                    />
                    <span>{provider.name}</span>
                  </span>
                );
              })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function CsfdProviderLink({ url, title }: { url: string; title: string }) {
  const label = `Více informací na ČSFD: ${title}`;
  return (
    <a
      className="provider-csfd-link"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
    >
      <img className="csfd-logo-mark" src="/csfd-logo.png" alt="" width="28" height="28" loading="lazy" />
      <span className="sr-only">ČSFD</span>
    </a>
  );
}

function RadarRating({
  title,
  csfd,
}: {
  title: string;
  csfd: CsfdMatch | null;
}) {
  const label =
    csfd?.rating == null
      ? `${title} na ČSFD, zatím bez hodnocení`
      : `${title} na ČSFD, hodnocení ${csfd.rating} %`;
  const badgeClass = `rating-badge${csfd?.url ? " rating-link" : ""} ${csfd?.rating == null ? "rating-missing" : getRatingClass(csfd.rating)}`;
  const badge = csfd?.url ? (
    <a
      className={badgeClass}
      href={csfd.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
    >
      {csfd.rating == null ? "?" : `${csfd.rating}%`}
    </a>
  ) : (
    <span className={badgeClass}>?</span>
  );
  return (
    <div className="csfd-block radar-csfd-block">
      <div className="csfd-line">
        {badge}
        <span className="rating-copy">{getCsfdStatusText(csfd)}</span>
      </div>
    </div>
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

function RadarWeeklyLoading({ weekStart }: { weekStart: string | null }) {
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
          <span aria-hidden="true">‹</span>
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
          <span aria-hidden="true">›</span>
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
          <table className="weekly-table radar-weekly-table radar-weekly-skeleton-table">
            <thead>
              <tr>
                <th className="weekly-film-heading" scope="col">
                  Film / seriál
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

function MobileAgendaSkeleton({ days }: { days: string[] }) {
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

function FilterToolbar({
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

function WeeklySchedule({
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
          <span aria-hidden="true">‹</span>
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
          <span aria-hidden="true">›</span>
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
          {films.map(film => (
            <tr key={film.id}>
              <th className="weekly-film-cell" scope="row">
                <FilmMini film={film} onSelectFilm={onSelectFilm} />
              </th>
              {days.map(day => {
                const screenings = film.screenings.filter(
                  screening => screening.dateISO === day,
                );
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

function compareScreeningTime(left: Screening, right: Screening) {
  return getScreeningSortMinutes(left) - getScreeningSortMinutes(right);
}

function getScreeningSortMinutes(screening: Screening) {
  if (!screening.time) return Number.POSITIVE_INFINITY;
  const match = screening.time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatMobileFilmMetadata(description: string) {
  return description
    .split(",")
    .map(part => part.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(", ");
}

function formatRadarCardMetadata(item: RadarItem, includeChannel: boolean) {
  const parts = [
    item.mediaType === "movie" ? "Film" : "Seriál",
    includeChannel ? (item.channel === "cinema" ? "Kino" : "Streaming") : null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(", ");
}

function ProgramMiniRating({
  title,
  csfd,
}: {
  title: string;
  csfd: CsfdMatch | null;
}) {
  const className = `weekly-rating ${csfd?.rating == null ? "rating-missing" : getRatingClass(csfd.rating)}`;
  const label =
    csfd?.rating == null
      ? `${title} na ČSFD, zatím bez hodnocení`
      : `${title} na ČSFD, hodnocení ${csfd.rating} %`;
  const badge = csfd?.url ? (
    <a
      className={className}
      href={csfd.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
    >
      {csfd.rating == null ? "?" : `${csfd.rating}%`}
    </a>
  ) : (
    <span className={className} aria-label={label} title={label}>
      ?
    </span>
  );
  return (
    <span className="weekly-rating-block">
      {badge}
      <span className="weekly-rating-copy">{getCsfdStatusText(csfd)}</span>
    </span>
  );
}

function MobileProgramAgendaItem({
  film,
  priority,
  onSelectFilm,
}: {
  film: FilmGroup;
  priority: boolean;
  onSelectFilm: (id: string) => void;
}) {
  return (
    <article
      className="mobile-program-item"
      aria-labelledby={`mobile-film-title-${film.id}`}
    >
      <div className="mobile-program-main">
        <Poster film={film} variant="mini" priority={priority} />
        <div className="mobile-program-copy">
          <button
            className="weekly-film-title-button mobile-program-title"
            type="button"
            id={`mobile-film-title-${film.id}`}
            onClick={() => onSelectFilm(film.id)}
          >
            {film.title}
          </button>
          {film.description ? (
            <p className="mobile-program-meta">{formatMobileFilmMetadata(film.description)}</p>
          ) : null}
          <div className="weekly-film-meta">
            <ProgramMiniRating title={film.title} csfd={film.csfd} />
          </div>
        </div>
      </div>
      <div className="mobile-agenda-times">
        {film.screenings.map(screening => (
          <CompactScreening film={film} screening={screening} key={screening.id} />
        ))}
      </div>
    </article>
  );
}

function FilmMini({
  film,
  onSelectFilm,
}: {
  film: FilmGroup;
  onSelectFilm: (id: string) => void;
}) {
  return (
    <div className="weekly-film-summary">
      <Poster film={film} variant="mini" />
      <div className="weekly-film-copy">
        <button
          className="weekly-film-title-button"
          type="button"
          onClick={() => onSelectFilm(film.id)}
        >
          {film.title}
        </button>
        <p className="weekly-film-description">
          {formatMobileFilmMetadata(film.description)}
        </p>
        <div className="weekly-film-meta">
          <ProgramMiniRating title={film.title} csfd={film.csfd} />
        </div>
      </div>
    </div>
  );
}

function FilmRow({
  film,
  priority,
  onSelectFilm,
}: {
  film: FilmGroup;
  priority: boolean;
  onSelectFilm?: (id: string) => void;
}) {
  return (
    <article
      className={film.hasSubtitles ? "film-row film-row-subtitles" : "film-row"}
      id={film.id}
      tabIndex={-1}
      aria-labelledby={`film-title-${film.id}`}
    >
      <div className="film-info">
        <div className="poster-column">
          <Poster film={film} priority={priority} />
        </div>
        <div className="film-copy">
          <div className="title-line">
            <h2 id={`film-title-${film.id}`}>
              {onSelectFilm ? (
                <button
                  className="film-title-button"
                  type="button"
                  onClick={() => onSelectFilm(film.id)}
                >
                  {film.title}
                </button>
              ) : (
                film.title
              )}
            </h2>
          </div>
          <p>{film.description}</p>
          <div className="csfd-block">
            <div className="csfd-line">
              {film.csfd?.rating != null ? (
                film.csfd.url ? (
                  <a
                    className={`rating-badge rating-link ${getRatingClass(film.csfd.rating)}`}
                    href={film.csfd.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${film.title} na ČSFD, hodnocení ${film.csfd.rating} %`}
                  >
                    {film.csfd.rating}%
                  </a>
                ) : (
                  <span
                    className={`rating-badge ${getRatingClass(film.csfd.rating)}`}
                  >
                    {film.csfd.rating}%
                  </span>
                )
              ) : film.csfd?.url ? (
                <a
                  className="rating-badge rating-link rating-missing"
                  href={film.csfd.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${film.title} na ČSFD, zatím bez hodnocení`}
                >
                  ?
                </a>
              ) : (
                <span className="rating-badge rating-missing">?</span>
              )}
              <span className="rating-copy">
                {getCsfdStatusText(film.csfd)}
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="screening-grid">
        {film.screenings.map(screening => (
          <ScreeningCard film={film} screening={screening} key={screening.id} />
        ))}
      </div>
    </article>
  );
}

function Poster({
  film,
  variant = "full",
  priority = false,
}: {
  film: FilmGroup;
  variant?: "full" | "mini";
  priority?: boolean;
}) {
  if (!film.posterUrl) {
    const className = variant === "mini" ? "weekly-poster" : "poster-frame";
    return (
      <div className={className}>
        <img
          src={POSTER_PLACEHOLDER_SRC}
          alt=""
          width={variant === "mini" ? 48 : 106}
          height={variant === "mini" ? 72 : 159}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
        />
      </div>
    );
  }
  const sources = getPosterSources(film.posterUrl);
  const className = variant === "mini" ? "weekly-poster" : "poster-frame";
  return (
    <div className={className}>
      <img
        src={sources.medium}
        srcSet={`${sources.small} 180w, ${sources.medium} 360w`}
        sizes={variant === "mini" ? "48px" : "(max-width: 720px) 88px, 106px"}
        width={variant === "mini" ? 48 : 106}
        height={variant === "mini" ? 72 : 159}
        alt=""
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        onError={event => {
          const image = event.currentTarget;
          if (!image.dataset.fallback) {
            image.dataset.fallback = "1";
            image.srcset = "";
            image.src = sources.original;
          } else if (image.src !== new URL(POSTER_PLACEHOLDER_SRC, window.location.href).href) {
            image.srcset = "";
            image.src = POSTER_PLACEHOLDER_SRC;
          }
        }}
      />
    </div>
  );
}

function ScreeningCard({
  film,
  screening,
}: {
  film: FilmGroup;
  screening: Screening;
}) {
  const targetUrl = screening.ticketUrl ?? screening.fidikoUrl;
  return (
    <a
      className={
        screening.hasSubtitles
          ? "screening-button screening-subtitles"
          : "screening-button"
      }
      href={targetUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${film.title}, ${screening.dateLabel}, ${screening.time ?? "detail"}${screening.ticketUrl ? ", vstupenky" : ""}`}
    >
      <span className="screening-date">{screening.dateLabel}</span>
      <span className="screening-time">
        {screening.time ?? screening.weekday ?? "Detail"}
      </span>
      {screening.weekday && screening.time ? (
        <span className="screening-weekday">{screening.weekday}</span>
      ) : null}
      <span className="format-row">
        {screening.formats.length ? (
          screening.formats.map(format => (
            <span
              className={
                format === "Titulky"
                  ? "format-badge format-subtitles"
                  : "format-badge"
              }
              key={format}
            >
              {format}
            </span>
          ))
        ) : (
          <span className="format-badge format-muted">Info</span>
        )}
      </span>
    </a>
  );
}

function CompactScreening({
  film,
  screening,
}: {
  film: FilmGroup;
  screening: Screening;
}) {
  const targetUrl = screening.ticketUrl ?? screening.fidikoUrl;
  return (
    <a
      className={
        screening.hasSubtitles
          ? "weekly-screening has-subtitles"
          : "weekly-screening"
      }
      href={targetUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${film.title}, ${screening.time ?? "detail"}${screening.ticketUrl ? ", vstupenky" : ""}`}
    >
      <strong>{screening.time ?? "Detail"}</strong>
      <span className="weekly-screening-formats">
        {screening.formats.length ? (
          screening.formats.map(format => (
            <span key={format}>{format}</span>
          ))
        ) : (
          <span>Info</span>
        )}
      </span>
    </a>
  );
}

function WeeklyLoading({
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
      aria-label="Načítání týdenního programu"
    >
      <div className="week-toolbar">
        <button
          className="week-nav-button"
          type="button"
          disabled
          aria-label="Předchozí týden"
        >
          <span aria-hidden="true">‹</span>
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
          <span aria-hidden="true">›</span>
        </button>
      </div>
      <div className="weekly-desktop">
        <div className="weekly-table-scroll">
          <div className="weekly-table-skeleton skeleton" />
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

function getPosterSources(url: string) {
  const replaceWidth = (width: number) =>
    url.replace(/\/cache\/resized\/w\d+\//, `/cache/resized/w${width}/`);
  return {
    small: replaceWidth(180),
    medium: replaceWidth(360),
    original: replaceWidth(1080),
  };
}

function usePosterPlaceholder(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget;
  if (image.src === new URL(POSTER_PLACEHOLDER_SRC, window.location.href).href) return;
  image.srcset = "";
  image.src = POSTER_PLACEHOLDER_SRC;
}

function getRadarPosterProps(url: string) {
  if (url.includes("image.tmdb.org/t/p/")) {
    const small = url.replace(/\/w\d+\//, "/w185/");
    const large = url.replace(/\/w\d+\//, "/w342/");
    return {
      src: small,
      srcSet: `${small} 185w, ${large} 342w`,
    };
  }

  if (url.includes("image.pmgstatic.com/cache/resized/")) {
    const small = url.replace(/\/cache\/resized\/w\d+(?:h\d+)?\//, "/cache/resized/w180/");
    const large = url.replace(/\/cache\/resized\/w\d+(?:h\d+)?\//, "/cache/resized/w360/");
    return {
      src: small,
      srcSet: `${small} 180w, ${large} 360w`,
    };
  }

  return { src: url };
}

function getCsfdStatusText(csfd: CsfdMatch | null) {
  if (!csfd?.url) return "ČSFD nenalezeno";
  if (csfd.ratingCount)
    return `${csfd.ratingCount.toLocaleString("cs-CZ")} hodnocení`;
  return "Bez hodnocení";
}

function getRatingClass(rating: number) {
  return rating >= 70
    ? "rating-good"
    : rating >= 30
      ? "rating-average"
      : "rating-bad";
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
  return new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatWeekRange(start: string | null, end: string | null) {
  if (!start || !end) return "Aktuální týden";
  const formatter = new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "long",
    year: start.slice(0, 4) === end.slice(0, 4) ? undefined : "numeric",
    timeZone: "UTC",
  });
  const endFormatter = new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${formatter.format(new Date(`${start}T00:00:00.000Z`))} - ${endFormatter.format(new Date(`${end}T00:00:00.000Z`))}`;
}

function formatScreeningCount(value: number) {
  return `Projekce: ${value}`;
}

function getUpcomingScreeningCount(program: RadarProgramMatch) {
  return program.upcomingScreeningCount ?? program.screeningCount;
}

function formatRadarTitle(value: string) {
  return value.replace(/Série\s+(\d+)$/i, "Série\u00a0$1");
}

function getProviderHref(provider: RadarProvider, preferMobile: boolean) {
  if (preferMobile && isHboMaxProvider(provider) && isAndroidDevice()) {
    return "intent://play.hbomax.com/#Intent;scheme=https;package=com.wbd.stream;S.browser_fallback_url=https%3A%2F%2Fplay.hbomax.com%2F;end";
  }
  if (!preferMobile) return provider.url;
  if (provider.mobileUrl) return provider.mobileUrl;
  return provider.linkType === "homepage" ? provider.url : null;
}

function isHboMaxProvider(provider: RadarProvider) {
  return provider.name.toLowerCase() === "hbo max";
}

function isAndroidDevice() {
  return /android/i.test(navigator.userAgent);
}

function getProviderLinkLabel(provider: RadarProvider, title: string, preferMobile = false) {
  const linkType = (preferMobile && provider.mobileUrl)
    ? provider.mobileLinkType ?? "homepage"
    : provider.linkType;
  const href = getProviderHref(provider, preferMobile);
  const isSearch = !href?.startsWith("intent://") && (
    linkType === "search" || Boolean(href?.match(/\/(?:search(?:\/result)?|vyhledavani|vyhledat)(?:[/?]|$)/i))
  );
  if (!isSearch) return `Otevřít ${provider.name}`;
  const searchTitle = title
    .replace(/\s*-\s*(?:série|serie|season)\s+\d+\s*$/iu, "")
    .trim();
  return `Vyhledat ${searchTitle} na ${provider.name}`;
}
function formatRadarDate(value: string) {
  return new Intl.DateTimeFormat("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(__BUILD_ID__)}`);
  });
}
