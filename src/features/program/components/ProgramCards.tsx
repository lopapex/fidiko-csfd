import type { FilmGroup, Screening } from "../../../types";
import {
  POSTER_PLACEHOLDER_SRC,
  formatDayLabel,
  formatMobileFilmMetadata,
  getDistinctiveFormats,
  getPosterSources,
} from "../../../shared/lib/view-helpers";
import { CalendarButton } from "../../../shared/components/FilmActions";
import { RatingBadge } from "../../../shared/components/RatingBadge";

const screeningUrl = (screening: Screening) => screening.ticketUrl ?? screening.fidikoUrl;

function FormatTags({ formats }: { formats: string[] }) {
  const tags = getDistinctiveFormats(formats);
  if (!tags.length) return null;
  return (
    <span className="format-tags">
      {tags.map(format => (
        <span className={format === "Titulky" ? "format-tag subtitles" : "format-tag"} key={format}>
          {format}
        </span>
      ))}
    </span>
  );
}

/** Agenda row (phones/tablets): poster, title, rating and the day's times. */
export function ProgramAgendaItem({
  film,
  priority,
  onSelectFilm,
}: {
  film: FilmGroup;
  priority: boolean;
  onSelectFilm: (id: string) => void;
}) {
  return (
    <article className="agenda-item" aria-labelledby={`agenda-film-${film.id}`}>
      <Poster film={film} variant="agenda" priority={priority} />
      <div className="agenda-item-copy">
        <button
          className="film-title-link"
          type="button"
          id={`agenda-film-${film.id}`}
          onClick={() => onSelectFilm(film.id)}
        >
          {film.title}
        </button>
        {film.description ? (
          <p className="item-meta">{formatMobileFilmMetadata(film.description)}</p>
        ) : null}
        <RatingBadge title={film.title} csfd={film.csfd} />
      </div>
      <div className="agenda-item-times">
        {film.screenings.map(screening => (
          <TimeLink film={film} screening={screening} key={screening.id} />
        ))}
      </div>
    </article>
  );
}

/** Time + distinctive formats, linking to tickets (or the Fidiko detail). */
function TimeLink({ film, screening }: { film: FilmGroup; screening: Screening }) {
  return (
    <a
      className="time-link"
      href={screeningUrl(screening)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${film.title}, ${formatDayLabel(screening.dateISO)} ${screening.time ?? ""}${screening.ticketUrl ? ", vstupenky" : ", detail"}`}
    >
      <strong>{screening.time ?? "Detail"}</strong>
      <FormatTags formats={screening.formats} />
    </a>
  );
}

/** "Filmy" card: one film with all its screenings as compact rows. */
export function FilmRow({ film, priority }: { film: FilmGroup; priority: boolean }) {
  return (
    <article className="film-card" id={film.id} tabIndex={-1} aria-labelledby={`film-title-${film.id}`}>
      <Poster film={film} priority={priority} />
      <div className="film-card-copy">
        <h2 id={`film-title-${film.id}`}>{film.title}</h2>
        {film.description ? <p className="item-meta">{film.description}</p> : null}
        <RatingBadge title={film.title} csfd={film.csfd} />
      </div>
      <ul className="screening-list" aria-label={`Promítání: ${film.title}`}>
        {film.screenings.map(screening => (
          <li className="screening-row" key={screening.id}>
            <a
              className="screening-link"
              href={screeningUrl(screening)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${film.title}, ${formatDayLabel(screening.dateISO)} ${screening.time ?? ""}${screening.ticketUrl ? ", vstupenky" : ", detail"}`}
            >
              <span className="screening-day">{formatDayLabel(screening.dateISO)}</span>
              <strong className="screening-time">{screening.time ?? "Detail"}</strong>
              <FormatTags formats={screening.formats} />
            </a>
            <CalendarButton screening={{ ...screening, title: film.title, description: film.description }} />
          </li>
        ))}
      </ul>
    </article>
  );
}

function Poster({
  film,
  variant = "full",
  priority = false,
}: {
  film: FilmGroup;
  variant?: "full" | "agenda";
  priority?: boolean;
}) {
  const width = variant === "agenda" ? 64 : 96;
  const height = width * 1.5;
  const className = `poster poster-${variant}`;
  if (!film.posterUrl) {
    return (
      <div className={className}>
        <img src={POSTER_PLACEHOLDER_SRC} alt="" width={width} height={height} loading={priority ? "eager" : "lazy"} />
      </div>
    );
  }
  const sources = getPosterSources(film.posterUrl);
  return (
    <div className={className}>
      <img
        src={sources.medium}
        srcSet={`${sources.small} 180w, ${sources.medium} 360w`}
        sizes={variant === "agenda" ? "(min-width: 761px) 80px, 64px" : `${width}px`}
        width={width}
        height={height}
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
