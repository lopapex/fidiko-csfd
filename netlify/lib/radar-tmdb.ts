export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const REQUEST_TIMEOUT_MS = 12000;
const REQUEST_ATTEMPTS = 3;

export type TmdbDiscoverItem = {
  id: number;
  title?: string;
  original_title?: string;
  name?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  release_date?: string;
  first_air_date?: string;
};

export type TmdbDiscoverResponse = {
  page: number;
  total_pages: number;
  results: TmdbDiscoverItem[];
};

export type TmdbTvDetails = TmdbDiscoverItem & {
  seasons?: Array<{
    season_number: number;
    name?: string;
    air_date?: string | null;
    poster_path?: string | null;
  }>;
};

export type TmdbProvider = {
  provider_id: number;
  provider_name: string;
  logo_path: string;
  display_priority: number;
};

export type TmdbWatchRegion = {
  link?: string;
  flatrate?: TmdbProvider[];
  free?: TmdbProvider[];
  ads?: TmdbProvider[];
};

export type TmdbWatchResponse = {
  results?: Record<string, TmdbWatchRegion>;
};

export const fetchDiscoverPages = async (
  token: string,
  path: string,
  baseParams: URLSearchParams,
  maxPages: number,
) => {
  const items: TmdbDiscoverItem[] = [];
  let totalPages = 1;

  for (let page = 1; page <= Math.min(totalPages, maxPages); page += 1) {
    const params = new URLSearchParams(baseParams);
    params.set("page", String(page));
    let response: TmdbDiscoverResponse;
    try {
      response = await tmdbFetch<TmdbDiscoverResponse>(token, `${path}?${params}`);
    } catch (error) {
      if (page === 1) {
        throw error;
      }
      console.warn(`TMDb ${path} page ${page} was skipped after retries`, error);
      break;
    }
    items.push(...response.results);
    totalPages = Math.max(1, response.total_pages);
  }

  return items;
};

export const tmdbFetch = async <T>(token: string, path: string): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${TMDB_API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: controller.signal,
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      const error = new Error(`TMDb ${path} failed with HTTP ${response.status}`);
      if (response.status < 500 || attempt === REQUEST_ATTEMPTS) {
        throw error;
      }
      lastError = error;
    } catch (error) {
      lastError = error;
      if (attempt === REQUEST_ATTEMPTS || (error instanceof Error && /HTTP 4\d\d$/.test(error.message))) {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }

    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
  }

  throw lastError;
};
