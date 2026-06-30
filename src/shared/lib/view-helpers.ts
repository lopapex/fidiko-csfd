import type { SyntheticEvent } from "react";
import type { CsfdMatch, RadarItem, RadarProgramMatch, RadarProvider } from "../../types";

export const POSTER_PLACEHOLDER_SRC = "/poster-placeholder.png";
export const getPosterSources = (url: string) => {
  const replaceWidth = (width: number) =>
    url.replace(/\/cache\/resized\/w\d+\//, `/cache/resized/w${width}/`);
  return {
    small: replaceWidth(180),
    medium: replaceWidth(360),
    original: replaceWidth(1080),
  };
}

export const usePosterPlaceholder = (event: SyntheticEvent<HTMLImageElement>) => {
  const image = event.currentTarget;
  if (image.src === new URL(POSTER_PLACEHOLDER_SRC, window.location.href).href) return;
  image.srcset = "";
  image.src = POSTER_PLACEHOLDER_SRC;
}

export const getRadarPosterProps = (url: string) => {
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

export const getCsfdStatusText = (csfd: CsfdMatch | null) => {
  if (!csfd?.url) return "ÄŒSFD nenalezeno";
  if (csfd.ratingCount)
    return `${csfd.ratingCount.toLocaleString("cs-CZ")} hodnocenÃ­`;
  return "Bez hodnocenÃ­";
}

export const getRatingClass = (rating: number) => {
  return rating >= 70
    ? "rating-good"
    : rating >= 30
      ? "rating-average"
      : "rating-bad";
}

export const getWeekDays = (weekStart: string) => {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}
export const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export const formatWeekday = (value: string) => {
  return new Intl.DateTimeFormat("cs-CZ", { weekday: "short", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00.000Z`))
    .replace(".", "");
}
export const formatShortDate = (value: string) => {
  return new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export const formatWeekRange = (start: string | null, end: string | null) => {
  if (!start || !end) return "AktuÃ¡lnÃ­ tÃ½den";
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

export const formatScreeningCount = (value: number) => {
  return `Projekce: ${value}`;
}

export const getUpcomingScreeningCount = (program: RadarProgramMatch) => {
  return program.upcomingScreeningCount ?? program.screeningCount;
}

export const formatRadarTitle = (value: string) => {
  return value.replace(/SÃ©rie\s+(\d+)$/i, "SÃ©rie\u00a0$1");
}

export const getProviderHref = (provider: RadarProvider, preferMobile: boolean) => {
  if (preferMobile && isHboMaxProvider(provider) && isAndroidDevice()) {
    return "intent://play.hbomax.com/#Intent;scheme=https;package=com.wbd.stream;S.browser_fallback_url=https%3A%2F%2Fplay.hbomax.com%2F;end";
  }
  if (!preferMobile) return provider.url;
  if (provider.mobileUrl) return provider.mobileUrl;
  return provider.linkType === "homepage" ? provider.url : null;
}

export const getProviderTileClassName = (provider: RadarProvider) => {
  return "provider-tile";
}

export const isHboMaxProvider = (provider: RadarProvider) => {
  return provider.name.toLowerCase() === "hbo max";
}

export const isAndroidDevice = () => {
  return /android/i.test(navigator.userAgent);
}

export const getProviderLinkLabel = (provider: RadarProvider, title: string, preferMobile = false) => {
  const linkType = (preferMobile && provider.mobileUrl)
    ? provider.mobileLinkType ?? "homepage"
    : provider.linkType;
  const href = getProviderHref(provider, preferMobile);
  const isSearch = !href?.startsWith("intent://") && (
    linkType === "search" || Boolean(href?.match(/\/(?:search(?:\/result)?|vyhledavani|vyhledat)(?:[/?]|$)/i))
  );
  if (!isSearch) return `OtevÅ™Ã­t ${provider.name}`;
  const searchTitle = title
    .replace(/\s*-\s*(?:sÃ©rie|serie|season)\s+\d+\s*$/iu, "")
    .trim();
  return `Vyhledat ${searchTitle} na ${provider.name}`;
}
export const formatRadarDate = (value: string) => {
  return new Intl.DateTimeFormat("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export const formatMobileFilmMetadata = (description: string) => description
  .split(",")
  .map(part => part.trim())
  .filter(Boolean)
  .slice(0, 4)
  .join(", ");

export const formatRadarCardMetadata = (item: RadarItem, includeChannel: boolean) => {
  const parts = [
    item.mediaType === "movie" ? "Film" : "Seriál",
    includeChannel ? (item.channel === "cinema" ? "Kino" : "Streaming") : null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(", ");
};

