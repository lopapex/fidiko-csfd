import { Clapperboard } from "lucide-react";
import type { CsfdMatch, RadarItem } from "../../../types";
import {
  POSTER_PLACEHOLDER_SRC,
  formatRadarCardMetadata,
  formatRadarDate,
  formatRadarTitle,
  getCsfdStatusText,
  getProviderHref,
  getProviderLinkLabel,
  getProviderTileClassName,
  getRadarPosterProps,
  getRatingClass,
  usePosterPlaceholder,
} from "../../../shared/lib/view-helpers";
export function RadarMini({
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

export function RadarReleaseCell({
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
                className={getProviderTileClassName(provider)}
                href={provider.url}
                target="_blank"
                rel="noopener noreferrer"
                title={label}
                aria-label={label}
                key={provider.id}
              >
                {provider.logoUrl ? (
                  <img src={provider.logoUrl} alt="" width="28" height="28" loading="lazy" />
                ) : (
                  <span>{provider.name}</span>
                )}
              </a>
            ) : (
              <span className={getProviderTileClassName(provider)} title={provider.name} key={provider.id}>
                {provider.logoUrl ? (
                  <img src={provider.logoUrl} alt="" width="28" height="28" loading="lazy" />
                ) : (
                  <span>{provider.name}</span>
                )}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function RadarCard({
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
                      className={getProviderTileClassName(provider)}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={label}
                    aria-label={label}
                    key={provider.id}
                  >
                    {provider.logoUrl ? (
                      <img
                        src={provider.logoUrl}
                        alt=""
                        width="32"
                        height="32"
                        loading="lazy"
                      />
                    ) : null}
                    <span>{provider.name}</span>
                  </a>
                ) : (
                  <span
                    className={getProviderTileClassName(provider)}
                    title={`${provider.name} nemá dostupný přímý odkaz`}
                    key={provider.id}
                  >
                    {provider.logoUrl ? (
                      <img
                        src={provider.logoUrl}
                        alt=""
                        width="32"
                        height="32"
                        loading="lazy"
                      />
                    ) : null}
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

