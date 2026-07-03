import { getProviderLink, isAllowedProvider } from "./radar-providers";
import { fetchDiscoverPages, TMDB_IMAGE_BASE, tmdbFetch, type TmdbDiscoverItem, type TmdbProvider, type TmdbTvDetails, type TmdbWatchResponse } from "./radar-tmdb";
import { mapConcurrent } from "./shared/concurrency";
import { decodeHtmlEntities } from "./text";
import type { ItemSourceResult, RadarChannel, RadarItem, RadarMediaType, RadarProvider } from "./radar-refresh";

const MAX_PAGES = 5;
const PROVIDER_CONCURRENCY = 6;

export type DiscoverResult = { items: TmdbDiscoverItem[]; succeeded: boolean };

export const discoverMovies = async (
  token: string,
  start: string,
  end: string,
  releaseType: string,
): Promise<DiscoverResult> => {
  const params = new URLSearchParams({
    language: "cs-CZ",
    region: "CZ",
    sort_by: "release_date.asc",
    "release_date.gte": start,
    "release_date.lte": end,
    with_release_type: releaseType,
    include_adult: "false",
    include_video: "false"
  });

  try {
    return { items: await fetchDiscoverPages(token, "/discover/movie", params, MAX_PAGES), succeeded: true };
  } catch (error) {
    console.warn(`TMDb ${releaseType === "4" ? "digital" : "regional cinema"} discovery failed for ${start} to ${end}`, error);
    return { items: [], succeeded: false };
  }
};

export const discoverSeries = async (token: string, start: string, end: string): Promise<DiscoverResult> => {
  const baseParams = new URLSearchParams({
    language: "cs-CZ",
    include_adult: "false",
    include_null_first_air_dates: "false",
  });

  const results = await Promise.allSettled(getSeriesDiscoveryDateFilters().flatMap(([gteKey, lteKey]) => (
    ["popularity.desc", "vote_count.desc"].map(async (sort) => {
      const params = new URLSearchParams(baseParams);
      params.set(gteKey, start);
      params.set(lteKey, end);
      params.set("sort_by", sort);
      return fetchDiscoverPages(token, "/discover/tv", params, MAX_PAGES);
    })
  )));
  const fulfilled = results.filter((result): result is PromiseFulfilledResult<TmdbDiscoverItem[]> => result.status === "fulfilled");
  if (fulfilled.length === 0) {
    console.warn(`TMDb series discovery failed for ${start} to ${end}`, results.map((result) => result.status === "rejected" ? result.reason : null));
    return { items: [], succeeded: false };
  }

  const unique = new Map<number, TmdbDiscoverItem>();
  for (const result of fulfilled) {
    for (const item of result.value) unique.set(item.id, item);
  }
  return { items: [...unique.values()], succeeded: true };
};

export const getSeriesDiscoveryDateFilters = () => [
  ["air_date.gte", "air_date.lte"],
  ["first_air_date.gte", "first_air_date.lte"],
] as const;

export const resolveSeriesPremieres = async (
  token: string,
  candidates: TmdbDiscoverItem[],
  start: string,
  end: string,
): Promise<{ items: TmdbDiscoverItem[]; succeeded: boolean }> => {
  const resolved = await mapConcurrent(candidates, PROVIDER_CONCURRENCY, async (candidate) => {
    try {
      const details = await tmdbFetch<TmdbTvDetails>(token, `/tv/${candidate.id}?language=cs-CZ`);
      const seasons = (details.seasons ?? []).filter((season) =>
        season.season_number > 0 && Boolean(season.air_date) && season.air_date! >= start && season.air_date! <= end
      );
      if (candidate.first_air_date && candidate.first_air_date >= start && candidate.first_air_date <= end) {
        return {
          succeeded: true,
          items: [{
            ...candidate,
            name: details.name ?? candidate.name,
            original_name: details.original_name ?? candidate.original_name,
            overview: details.overview ?? candidate.overview,
            poster_path: details.poster_path ?? candidate.poster_path,
          }],
        };
      }

      return {
        succeeded: true,
        items: seasons.map((season) => ({
          ...candidate,
          name: `${details.name ?? candidate.name} - Série ${season.season_number}`,
          original_name: `${details.original_name ?? candidate.original_name ?? candidate.name} - Série ${season.season_number}`,
          overview: details.overview ?? candidate.overview,
          poster_path: season.poster_path ?? details.poster_path ?? candidate.poster_path,
          first_air_date: season.air_date ?? undefined
        })),
      };
    } catch (error) {
      console.warn(`TMDb seasons for series ${candidate.id} were skipped`, error);
      return { succeeded: false, items: [] };
    }
  });

  return {
    items: resolved.flatMap((result) => result.items),
    succeeded: candidates.length === 0 || resolved.some((result) => result.succeeded),
  };
};

export const enrichStreamingItems = async (
  token: string,
  candidates: TmdbDiscoverItem[],
  mediaType: RadarMediaType,
): Promise<ItemSourceResult> => {
  const enriched = await mapConcurrent(candidates, PROVIDER_CONCURRENCY, async (item) => {
    let watch: TmdbWatchResponse;
    try {
      watch = await tmdbFetch<TmdbWatchResponse>(
        token,
        mediaType === "movie" ? `/movie/${item.id}/watch/providers` : `/tv/${item.id}/watch/providers`
      );
    } catch (error) {
      console.warn(`TMDb providers for ${mediaType} ${item.id} were skipped`, error);
      return { succeeded: false, item: null };
    }
    const region = watch.results?.CZ;
    if (!region) {
      return { succeeded: true, item: createRadarItem(item, mediaType, "streaming", { providers: [], watchUrl: null }) };
    }

    const title = mediaType === "movie" ? item.title : item.name;
    const providers = deduplicateProviders(
      [...(region.flatrate ?? []), ...(region.free ?? []), ...(region.ads ?? [])],
      title,
    );
    if (providers.length === 0) {
      return {
        succeeded: true,
        item: createRadarItem(item, mediaType, "streaming", { providers: [], watchUrl: region.link ?? null }),
      };
    }

    return {
      succeeded: true,
      item: createRadarItem(item, mediaType, "streaming", { providers, watchUrl: region.link ?? null }),
    };
  });

  return {
    items: enriched.map((result) => result.item).filter((item): item is RadarItem => item !== null),
    succeeded: candidates.length === 0 || enriched.some((result) => result.succeeded),
  };
};

export const createRadarItem = (
  item: TmdbDiscoverItem,
  mediaType: RadarMediaType,
  channel: RadarChannel,
  streaming: { providers: RadarProvider[]; watchUrl: string | null } | null
): RadarItem => {
  const title = decodeHtmlEntities((mediaType === "movie" ? item.title : item.name) ?? "");
  const originalTitle = decodeHtmlEntities((mediaType === "movie" ? item.original_title : item.original_name) ?? "");
  const releaseDate = mediaType === "movie" ? item.release_date : item.first_air_date;

  if (!title || !releaseDate) {
    throw new Error(`TMDb item ${item.id} is missing a title or release date`);
  }

  return {
    id: `${mediaType}-${item.id}-${channel}-${releaseDate}`,
    tmdbId: item.id,
    mediaType,
    channel,
    title,
    originalTitle: originalTitle && originalTitle !== title ? originalTitle : null,
    overview: decodeHtmlEntities(item.overview?.trim() ?? ""),
    posterUrl: item.poster_path ? `${TMDB_IMAGE_BASE}/w342${item.poster_path}` : null,
    releaseDate,
    providers: streaming?.providers ?? [],
    watchUrl: streaming?.watchUrl ?? null,
    csfd: null,
    program: null
  };
};

const deduplicateProviders = (providers: TmdbProvider[], title?: string) => {
  const unique = new Map<number, TmdbProvider>();
  for (const provider of providers) {
    unique.set(provider.provider_id, provider);
  }

  return [...unique.values()]
    .filter((provider) => !isHiddenProvider(provider.provider_name))
    .sort((left, right) => left.display_priority - right.display_priority)
    .map((provider) => ({
      id: provider.provider_id,
      name: provider.provider_name,
      logoUrl: `${TMDB_IMAGE_BASE}/w45${provider.logo_path}`,
      ...getProviderLink(provider.provider_name, title),
    }));
};

export const isHiddenProvider = (name: string) => !isAllowedProvider(name);
