import { csfd } from "node-csfd-api";

const LOOKUP_CONCURRENCY = 6;
const MAX_URLS = 80;

export type CsfdRating = {
  rating: number | null;
  ratingCount: number | null;
};

export type CsfdRatingsResponse = {
  fetchedAt: string;
  ratings: Record<string, CsfdRating>;
};

type RatingLookup = (id: number) => Promise<CsfdRating | null>;
type ItemWithCsfdRating = {
  csfd: (CsfdRating & { url: string | null }) | null;
};

export async function createCsfdRatingsResponse(
  urls: unknown,
  lookup: RatingLookup = lookupCsfdRating,
): Promise<CsfdRatingsResponse> {
  const normalizedUrls = normalizeRequestUrls(urls);
  const byId = new Map<number, string[]>();

  for (const url of normalizedUrls) {
    const id = extractCsfdMovieId(url);
    if (!id) continue;
    byId.set(id, [...(byId.get(id) ?? []), url]);
  }

  const ratings: Record<string, CsfdRating> = {};
  await mapConcurrent([...byId.entries()], LOOKUP_CONCURRENCY, async ([id, urlsForId]) => {
    const rating = await lookup(id);
    if (!rating) return;
    for (const url of urlsForId) {
      ratings[url] = rating;
    }
  });

  return {
    fetchedAt: new Date().toISOString(),
    ratings,
  };
}

export async function patchItemsWithFreshCsfdRatings<T extends ItemWithCsfdRating>(
  items: T[],
  lookup: RatingLookup = lookupCsfdRating,
) {
  const urls = items
    .map((item) => item.csfd?.url)
    .filter((url): url is string => Boolean(url));
  if (urls.length === 0) return items;

  try {
    const { ratings } = await createCsfdRatingsResponse(urls, lookup);
    return items.map((item) => {
      const rating = item.csfd?.url ? ratings[item.csfd.url] : null;
      return rating && item.csfd
        ? { ...item, csfd: { ...item.csfd, ...rating } }
        : item;
    });
  } catch (error) {
    console.warn("CSFD snapshot rating refresh failed", error);
    return items;
  }
}

export function extractCsfdMovieId(value: string) {
  try {
    const url = new URL(value);
    if (!/(^|\.)csfd\.cz$/i.test(url.hostname)) return null;
    return extractCsfdMovieIdFromPath(url.pathname);
  } catch {
    return extractCsfdMovieIdFromPath(value.replace(/[?#].*$/, ""));
  }
}

function extractCsfdMovieIdFromPath(path: string) {
  const filmPath = path.match(/\/film\/(.+)$/);
  if (!filmPath) return null;
  const ids = [...filmPath[1].matchAll(/(?:^|\/)(\d+)(?:[/-]|$)/g)]
    .map(match => Number(match[1]))
    .filter(id => Number.isSafeInteger(id) && id > 0);
  const id = ids.at(-1);
  if (!id) return null;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizeRequestUrls(urls: unknown) {
  if (!Array.isArray(urls)) return [];
  return [...new Set(urls.filter((url): url is string => typeof url === "string" && url.length > 0))]
    .slice(0, MAX_URLS);
}

async function lookupCsfdRating(id: number): Promise<CsfdRating | null> {
  try {
    const movie = await csfd.movie(id);
    if (!movie) return null;
    return {
      rating: numberOrNull(movie.rating),
      ratingCount: numberOrNull(movie.ratingCount),
    };
  } catch (error) {
    console.warn(`CSFD rating lookup failed for ${id}`, error);
    return null;
  }
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
