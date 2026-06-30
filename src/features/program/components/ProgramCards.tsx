import type { CsfdMatch, FilmGroup, Screening } from "../../../types";
import {
  POSTER_PLACEHOLDER_SRC,
  formatMobileFilmMetadata,
  getCsfdStatusText,
  getPosterSources,
  getRatingClass,
  usePosterPlaceholder,
} from "../../../shared/lib/view-helpers";
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

export function MobileProgramAgendaItem({
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

export function FilmMini({
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

export function FilmRow({
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

export function CompactScreening({
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


