import type { RadarItem, RadarProvider } from "../../../types";
import {
  POSTER_PLACEHOLDER_SRC,
  formatRadarCardMetadata,
  formatRadarTitle,
  getProviderHref,
  getProviderLinkLabel,
  getRadarPosterProps,
  usePosterPlaceholder,
} from "../../../shared/lib/view-helpers";
import { RatingBadge } from "../../../shared/components/RatingBadge";
import { useIsMobileLayout } from "../../../shared/lib/use-media-query";

/** Premiere in the agenda: poster, title, kind, rating, where to watch. */
export function RadarAgendaItem({
  item,
  priority,
  onSelectProgramFilm,
}: {
  item: RadarItem;
  priority: boolean;
  onSelectProgramFilm: (id: string) => void;
}) {
  return (
    <article className="agenda-item radar-item">
      <div className="poster poster-agenda">
        {item.posterUrl ? (
          <img
            {...getRadarPosterProps(item.posterUrl)}
            sizes="(min-width: 761px) 80px, 64px"
            alt=""
            width="64"
            height="96"
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            onError={usePosterPlaceholder}
          />
        ) : (
          <img src={POSTER_PLACEHOLDER_SRC} alt="" width="64" height="96" loading="lazy" />
        )}
      </div>
      <div className="agenda-item-copy">
        <RadarTitle item={item} onSelectProgramFilm={onSelectProgramFilm} />
        <p className="item-meta">{formatRadarCardMetadata(item)}</p>
        <RatingBadge title={item.title} csfd={item.csfd} />
      </div>
      <div className="agenda-item-side">
        <WhereToWatch item={item} onSelectProgramFilm={onSelectProgramFilm} />
      </div>
    </article>
  );
}

function RadarTitle({ item, onSelectProgramFilm }: { item: RadarItem; onSelectProgramFilm: (id: string) => void }) {
  const title = formatRadarTitle(item.title);
  return item.program ? (
    <button className="film-title-link" type="button" onClick={() => onSelectProgramFilm(item.program!.filmId)}>
      {title}
    </button>
  ) : (
    <strong className="film-title-text">{title}</strong>
  );
}

/** Cinema → "V programu" link; streaming → provider logos (or ČSFD when none is known). */
function WhereToWatch({
  item,
  onSelectProgramFilm,
}: {
  item: RadarItem;
  onSelectProgramFilm: (id: string) => void;
}) {
  const isPhone = useIsMobileLayout();
  if (item.program) {
    return (
      <button
        className="where-chip"
        type="button"
        onClick={() => onSelectProgramFilm(item.program!.filmId)}
        aria-label={`${item.title}: otevřít v programu kina`}
      >
        V programu
      </button>
    );
  }
  if (item.channel === "cinema") return null;
  if (item.providers.length === 0) {
    return item.csfd?.url ? (
      <a
        className="provider-logo"
        href={item.csfd.url}
        target="_blank"
        rel="noopener noreferrer"
        title={`Více informací na ČSFD: ${item.title}`}
        aria-label={`Více informací na ČSFD: ${item.title}`}
      >
        <img src="/csfd-logo.png" alt="" width="28" height="28" loading="lazy" />
      </a>
    ) : null;
  }
  // Phones get app deep links and the single best provider; wider screens list them all.
  const preferMobile = isPhone;
  const providers = preferMobile ? item.providers.slice(0, 1) : item.providers;
  return (
    <span className="provider-logos">
      {providers.map(provider => (
        <ProviderLogo provider={provider} title={item.title} preferMobile={preferMobile} key={provider.id} />
      ))}
    </span>
  );
}

function ProviderLogo({ provider, title, preferMobile }: { provider: RadarProvider; title: string; preferMobile: boolean }) {
  const href = getProviderHref(provider, preferMobile);
  const label = getProviderLinkLabel(provider, title, preferMobile);
  const content = provider.logoUrl ? (
    <img src={provider.logoUrl} alt="" width="28" height="28" loading="lazy" />
  ) : (
    <span>{provider.name}</span>
  );
  return href ? (
    <a
      className={provider.logoUrl ? "provider-logo" : "provider-logo provider-logo-text"}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
    >
      {content}
    </a>
  ) : (
    <span
      className={provider.logoUrl ? "provider-logo unavailable" : "provider-logo provider-logo-text unavailable"}
      title={`${provider.name} nemá dostupný přímý odkaz`}
    >
      {content}
    </span>
  );
}
