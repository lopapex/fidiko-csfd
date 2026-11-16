import { csfd, type CSFDMovie, type CSFDSearchMovie } from "node-csfd-api";

/**
 * The only door to ČSFD. node-csfd-api swallows network errors (a failed search
 * looks like "no results"), so every call here is:
 *  - limited to a few requests in flight for the whole process (ČSFD throttles bursts),
 *  - bounded by a timeout,
 *  - retried once with a short pause,
 *  - and reports a failure as a thrown CsfdUnavailableError, never as an empty result.
 */

const MAX_IN_FLIGHT = 6;
const REQUEST_TIMEOUT_MS = 5000;
const ATTEMPTS = 2;
const RETRY_PAUSE_MS = 350;

export class CsfdUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsfdUnavailableError";
  }
}

export type CsfdSearchResult = { movies: CSFDSearchMovie[]; tvSeries: CSFDSearchMovie[] };

export type CsfdClient = {
  search: (query: string) => Promise<CsfdSearchResult>;
  movie: (id: number) => Promise<CSFDMovie>;
};

let inFlight = 0;
const waiting: Array<() => void> = [];

const acquire = async () => {
  if (inFlight >= MAX_IN_FLIGHT) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  inFlight += 1;
};

const release = () => {
  inFlight -= 1;
  waiting.shift()?.();
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = <T>(promise: Promise<T>, label: string) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CsfdUnavailableError(`${label} timed out`)), REQUEST_TIMEOUT_MS);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });

async function request<T>(label: string, run: () => Promise<T>, isUsable: (value: T) => boolean): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    await acquire();
    try {
      const value = await withTimeout(run(), label);
      if (isUsable(value)) return value;
      lastError = new CsfdUnavailableError(`${label} returned an empty page`);
    } catch (error) {
      lastError = error;
    } finally {
      release();
    }
    if (attempt < ATTEMPTS) await pause(RETRY_PAUSE_MS * attempt);
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new CsfdUnavailableError(`${label} failed: ${detail}`);
}

/**
 * A real ČSFD search page always lists something (fuzzy users/creators at least);
 * a page with nothing at all is a failed or blocked request.
 */
export const isUsableSearchResult = (result: {
  movies?: unknown[];
  tvSeries?: unknown[];
  creators?: unknown[];
  users?: unknown[];
} | null | undefined) =>
  Boolean(result) &&
  (result!.movies?.length ?? 0) + (result!.tvSeries?.length ?? 0) + (result!.creators?.length ?? 0) + (result!.users?.length ?? 0) > 0;

export const csfdClient: CsfdClient = {
  search: async (query) => {
    const result = await request(`CSFD search "${query}"`, () => csfd.search(query), isUsableSearchResult);
    return { movies: result.movies ?? [], tvSeries: result.tvSeries ?? [] };
  },
  movie: (id) =>
    request(`CSFD film ${id}`, () => csfd.movie(id), (movie) => Boolean(movie?.title && movie.url)),
};
