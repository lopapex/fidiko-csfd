import * as cheerio from "cheerio";
import { getStore } from "@netlify/blobs";
import { patchItemsWithFreshCsfdRatings } from "./csfd-ratings";
import { comparableCountry, resolveCsfdTitle } from "./csfd-match";
import { decodeHtmlEntities } from "./text";

const FIDIKO_BASE = "https://www.fidiko.cz/";
const MAX_PAGES = 50;
const FETCH_TIMEOUT_MS = 12000;
const FETCH_RETRIES = 2;
const CSFD_TIMEOUT_MS = 20000;
const CSFD_CONCURRENCY = 4;
const CSFD_CACHE_STORE = "csfd-cache";
const CSFD_CACHE_VERSION = "v3";
const SCHEDULE_CACHE_STORE = "schedule-cache";
const SCHEDULE_CACHE_KEY = "current-v2";
const FORMAT_TAG_PATTERN = "(?:ČT|čT|čt|CT|ct|ČV|čV|čv|CV|cv|ČD|čD|čd|CD|cd|OV|ov|NES|nes|3D|3d|2D|2d)";
const FORMAT_TAG_GROUP_RE = new RegExp(`\\s*\\(\\s*${FORMAT_TAG_PATTERN}\\s*\\)`, "gi");
const SUBTITLE_TAG_RE = /\((?:\s*(?:ČT|čT|čt|CT|ct)\s*)\)/i;
const DUBBING_TAG_RE = /\((?:\s*(?:ČV|čV|čv|CV|cv|ČD|čD|čd|CD|cd)\s*)\)/i;
// Fidiko writes "<title> (<tag>) - <event>": whatever follows a tag is about the screening, not the film.
const TAGGED_TITLE_RE = /^(.*?\S)\s*\(\s*[A-ZČŠŽ0-9]{2,5}\s*\)(?:\s*\(\s*[A-ZČŠŽ0-9]{2,5}\s*\))*(?:\s+[-–].*)?$/;
const MOVIE_FORMAT_TAG_RE = new RegExp(`\\(\\s*${FORMAT_TAG_PATTERN}\\s*\\)`, "i");
const TITLE_SUFFIX_RE =
  /\s+-\s+(?:PREMIÉRA|PREMIERA|Kino senior|Filmový klub|Dopoledn|TICHÁ STŘEDA|TICHA STREDA).*$/i;

export type RawScreening = {
  id: string;
  sourceOrder: number;
  title: string;
  normalizedTitle: string;
  fidikoUrl: string;
  ticketUrl: string | null;
  posterUrl: string | null;
  dateText: string;
  dateLabel: string;
  dateISO: string;
  weekday: string | null;
  time: string | null;
  description: string;
  formats: string[];
  hasSubtitles: boolean;
};

type CsfdMatch = {
  title: string;
  rating: number | null;
  ratingCount: number | null;
  url: string | null;
  poster: string | null;
};

export type FilmGroup = {
  id: string;
  title: string;
  posterUrl: string | null;
  description: string;
  hasSubtitles: boolean;
  csfd: CsfdMatch | null;
  screenings: RawScreening[];
};

export type ScheduleResponse = {
  fetchedAt: string;
  source: string;
  totals: {
    films: number;
    screenings: number;
    withSubtitles: number;
  };
  period: {
    mode: "all" | "week";
    weekStart: string | null;
    weekEnd: string | null;
    previousWeekStart: string | null;
    nextWeekStart: string | null;
  };
  films: FilmGroup[];
};

type ScreeningHints = {
  countries: string[];
};

const csfdCache = new Map<string, Promise<CsfdMatch | null>>();

export async function refreshScheduleCache() {
  const screenings = await fetchAllScreenings();
  const groups = await groupScreenings(screenings, true);
  const films = await patchItemsWithFreshCsfdRatings(groups);
  const schedule: ScheduleResponse = {
    fetchedAt: new Date().toISOString(),
    source: FIDIKO_BASE,
    totals: {
      films: films.length,
      screenings: screenings.length,
      withSubtitles: films.filter((group) => group.hasSubtitles).length
    },
    period: {
      mode: "all",
      weekStart: null,
      weekEnd: null,
      previousWeekStart: null,
      nextWeekStart: null
    },
    films
  };

  await getScheduleStore().setJSON(SCHEDULE_CACHE_KEY, schedule);
  return schedule;
}

export async function hasScheduleCache() {
  return Boolean(await getScheduleStore().get(SCHEDULE_CACHE_KEY));
}

function getScheduleStore() {
  return getStore(SCHEDULE_CACHE_STORE, { consistency: "strong" });
}

function getCsfdStore() {
  return getStore(CSFD_CACHE_STORE, { consistency: "strong" });
}

async function fetchAllScreenings() {
  const screenings: RawScreening[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const html = await fetchFidikoPage(page);
    const pageScreenings = parseScreenings(html, page);

    if (pageScreenings.length === 0) {
      break;
    }

    screenings.push(...pageScreenings);
  }

  return screenings;
}

async function fetchFidikoPage(page: number) {
  const url = new URL(FIDIKO_BASE);
  url.searchParams.set("ajax", "1");
  url.searchParams.append("feed[]", "Kino");
  url.searchParams.set("page", String(page));

  for (let attempt = 1; attempt <= FETCH_RETRIES + 1; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
          Referer: FIDIKO_BASE
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response.text();
    } catch (error) {
      if (attempt > FETCH_RETRIES) {
        const detail = error instanceof Error ? error.message : "Unknown error";
        throw new Error(`Fidiko page ${page} fetch failed after ${attempt} attempts: ${detail}`);
      }

      await wait(250 * attempt);
    }
  }

  throw new Error(`Fidiko page ${page} fetch failed`);
}

async function fetchWithTimeout(url: URL, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T) {
  return new Promise<T>((resolve) => {
    const timeout = setTimeout(() => {
      resolve(fallback);
    }, ms);

    promise
      .then(resolve)
      .catch(() => resolve(fallback))
      .finally(() => {
        clearTimeout(timeout);
      });
  });
}

function parseScreenings(html: string, page: number) {
  const $ = cheerio.load(html);
  const screenings: RawScreening[] = [];

  $("article.event").each((index, element) => {
    const article = $(element);
    const titleAnchor = article.find(".content h2 a").first();
    const image = article.find("img").first();
    const ticketAnchor = article.find(".double-button a.primary").first();
    const infoAnchor = article.find(".double-button a.secondary").first();
    const title = cleanText(titleAnchor.attr("title") || titleAnchor.text());

    if (!title) {
      return;
    }

    const fidikoUrl = absolutize(titleAnchor.attr("href") || infoAnchor.attr("href"));
    const ticketUrl = absolutize(ticketAnchor.attr("href"));
    const description = cleanText(article.find(".description").text());
    const dateText = cleanText(article.find(".date").text());
    const dateParts = parseDateText(dateText);
    const formats = extractFormats(title, description);

    if (!isLikelyMovieScreening(title, description)) {
      return;
    }

    screenings.push({
      id: `${page}-${index}-${slugify(title)}-${slugify(dateText)}`,
      sourceOrder: page * 1000 + index,
      title,
      normalizedTitle: normalizeFilmTitle(title),
      fidikoUrl: fidikoUrl || FIDIKO_BASE,
      ticketUrl,
      posterUrl: absolutize(image.attr("src")),
      dateText,
      dateLabel: dateParts.dateLabel,
      dateISO: inferScreeningDateISO(dateParts.dateLabel),
      weekday: dateParts.weekday,
      time: dateParts.time,
      description,
      formats,
      hasSubtitles: detectsSubtitles(title, description)
    });
  });

  return screenings;
}

async function groupScreenings(screenings: RawScreening[], pruneCache: boolean) {
  const map = new Map<string, RawScreening[]>();

  for (const screening of screenings) {
    const key = screening.normalizedTitle;
    const bucket = map.get(key) ?? [];
    bucket.push(screening);
    map.set(key, bucket);
  }

  const entries = [...map.entries()];
  const activeCsfdKeys = new Set(entries.map(([title, items]) => createCsfdCacheKey(title)));
  const groups: FilmGroup[] = await mapConcurrent(entries, CSFD_CONCURRENCY, async ([title, items]) => {
      const sortedScreenings = items.sort(compareScreenings);
      const csfdMatch = await getCsfdMatch(title, sortedScreenings);

      return {
        id: slugify(title),
        title,
        posterUrl: optimizeCsfdPoster(csfdMatch?.poster ?? null) ?? sortedScreenings.find((screening) => screening.posterUrl)?.posterUrl ?? null,
        description: cleanMovieDescription(firstUsefulDescription(sortedScreenings)),
        hasSubtitles: sortedScreenings.some((screening) => screening.hasSubtitles),
        csfd: csfdMatch,
        screenings: sortedScreenings
      } satisfies FilmGroup;
    });

  // A miss is often just a slow or throttled CSFD response during the parallel pass.
  // Ask again, one film at a time, before publishing a film without a rating.
  for (const group of groups) {
    if (group.csfd) continue;
    const csfdMatch = await getCsfdMatch(group.title, group.screenings);
    if (!csfdMatch) continue;
    group.csfd = csfdMatch;
    group.posterUrl = optimizeCsfdPoster(csfdMatch.poster) ?? group.posterUrl;
  }

  if (pruneCache) {
    await pruneCsfdCache(activeCsfdKeys);
  }
  return groups.sort((left, right) => compareScreenings(left.screenings[0], right.screenings[0]) || left.title.localeCompare(right.title, "cs"));
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function getCsfdMatch(query: string, screenings: RawScreening[]) {
  const hints = getScreeningHints(screenings);
  const cacheKey = createCsfdCacheKey(query);
  const cached = csfdCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const promise = loadOrLookupCsfd(query, hints);
  csfdCache.set(cacheKey, promise);
  // Only matches are remembered; a miss is looked up again next time.
  void promise.then((match) => {
    if (!match && csfdCache.get(cacheKey) === promise) csfdCache.delete(cacheKey);
  });
  return promise;
}

async function loadOrLookupCsfd(query: string, hints: ScreeningHints) {
  const persistentKey = createCsfdCacheKey(query);

  try {
    const cached = (await getCsfdStore().get(persistentKey, { type: "json" })) as CsfdMatch | null;
    if (cached) {
      return cached;
    }
  } catch (error) {
    console.warn(`Persistent CSFD cache read failed for "${query}"`, error);
  }

  const match = await withTimeout(lookupCsfd(query, hints), CSFD_TIMEOUT_MS, null);

  if (match) {
    try {
      await getCsfdStore().setJSON(persistentKey, match);
    } catch (error) {
      console.warn(`Persistent CSFD cache write failed for "${query}"`, error);
    }
  }

  return match;
}

function createCsfdCacheKey(query: string) {
  return `${CSFD_CACHE_VERSION}/${slugify(query)}`;
}

async function pruneCsfdCache(activeKeys: Set<string>) {
  try {
    const store = getCsfdStore();
    const { blobs } = await store.list();
    const staleKeys = blobs.map((blob) => blob.key).filter((key) => !activeKeys.has(key));

    await Promise.all(staleKeys.map((key) => store.delete(key)));

    if (staleKeys.length > 0) {
      console.log(`Removed ${staleKeys.length} stale CSFD cache entries`);
    }
  } catch (error) {
    console.warn("Persistent CSFD cache cleanup failed", error);
  }
}

/** A miss and a ČSFD outage both give `null`; neither is remembered, so the next pass asks again. */
async function lookupCsfd(query: string, hints: ScreeningHints): Promise<CsfdMatch | null> {
  try {
    const outcome = await resolveCsfdTitle({ titles: [query], kind: "movie", countries: hints.countries });
    if (outcome.status !== "matched") {
      console.warn(`CSFD match for "${query}": ${outcome.status}`);
      return null;
    }

    const { candidate, details } = outcome;
    return {
      title: details?.title ?? candidate.title,
      rating: numberOrNull(details?.rating),
      ratingCount: numberOrNull(details?.ratingCount),
      url: details?.url ?? candidate.url ?? null,
      poster: optimizeCsfdPoster(details?.poster ?? candidate.poster ?? null)
    };
  } catch (error) {
    console.warn(`CSFD lookup failed for "${query}"`, error);
    return null;
  }
}

/**
 * Between the nightly refreshes: ask ČSFD again for the films that are still
 * without a match, so one bad moment at midnight does not last the whole day.
 */
export async function repairScheduleCsfd() {
  const store = getScheduleStore();
  const schedule = (await store.get(SCHEDULE_CACHE_KEY, { type: "json" })) as ScheduleResponse | null;
  const unmatched = schedule?.films.filter((film) => !film.csfd?.url) ?? [];
  if (!schedule || unmatched.length === 0) return 0;

  let repaired = 0;
  for (const film of unmatched) {
    const match = await getCsfdMatch(film.title, film.screenings);
    if (!match?.url) continue;
    film.csfd = match;
    film.posterUrl = optimizeCsfdPoster(match.poster) ?? film.posterUrl;
    repaired += 1;
  }

  if (repaired > 0) await store.setJSON(SCHEDULE_CACHE_KEY, schedule);
  return repaired;
}

function optimizeCsfdPoster(url: string | null) {
  if (!url) {
    return null;
  }

  return url.replace(/\/cache\/resized\/w\d+\//, "/cache/resized/w360/");
}

function getScreeningHints(screenings: RawScreening[]): ScreeningHints {
  const countries = new Set<string>();

  // "USA, Komedie, 12+, 2D, dabing": the countries come first; genres never equal a ČSFD origin.
  for (const screening of screenings) {
    for (const part of screening.description.split(",")) {
      const country = comparableCountry(part);
      if (country && !/\d/.test(country)) {
        countries.add(country);
      }
    }
  }

  return {
    countries: [...countries].sort()
  };
}

function parseDateText(value: string) {
  const parts = value
    .split("|")
    .map((part) => cleanText(part))
    .filter(Boolean);

  const dateLabel = parts[0] ?? value;
  const weekday = parts.length > 2 ? parts[1] : null;
  const time = parts.find((part) => /\d{1,2}:\d{2}/.test(part)) ?? null;

  return { dateLabel, weekday, time };
}

export function inferScreeningDateISO(dateLabel: string) {
  const match = dateLabel.match(/(\d{1,2})\.(\d{1,2})\./);
  if (!match) {
    throw new Error(`Unsupported screening date: ${dateLabel}`);
  }

  const today = getPragueTodayISO();
  const currentYear = Number(today.slice(0, 4));
  const month = Number(match[2]);
  const day = Number(match[1]);
  let candidate = createISODate(currentYear, month, day);

  if (daysBetweenISO(candidate, today) > 31) {
    candidate = createISODate(currentYear + 1, month, day);
  }

  return candidate;
}

function getPragueTodayISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

function createISODate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Invalid screening date: ${day}.${month}.${year}`);
  }

  return date.toISOString().slice(0, 10);
}

function parseISODate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function daysBetweenISO(earlier: string, later: string) {
  const earlierDate = parseISODate(earlier);
  const laterDate = parseISODate(later);
  if (!earlierDate || !laterDate) {
    return 0;
  }

  return (laterDate.getTime() - earlierDate.getTime()) / 86_400_000;
}

export function normalizeFilmTitle(title: string) {
  return cleanText(
    title
      .replace(TAGGED_TITLE_RE, "$1")
      .replace(FORMAT_TAG_GROUP_RE, "")
      .replace(TITLE_SUFFIX_RE, "")
      .replace(/\s+/g, " ")
  );
}

export function extractFormats(title: string, description: string) {
  const formats: string[] = [];
  const combined = (title + " " + description).toLowerCase();

  if (detectsSubtitles(title, description)) {
    formats.push("Titulky");
  } else if (isDubbed(title, description)) {
    formats.push("Dabing");
  } else if (isOriginalVersion(title)) {
    formats.push("Originál");
  }
  if (combined.includes("dabing") || DUBBING_TAG_RE.test(title)) formats.push("Dabing");
  if (combined.includes("2d")) formats.push("2D");
  if (combined.includes("3d")) formats.push("3D");
  if (isOriginalVersion(title)) formats.push("Originál");
  if (title.includes("Kino senior")) formats.push("Kino senior");
  if (title.includes("Filmový klub")) formats.push("Filmový klub");
  if (title.toLowerCase().includes("premiéra") || title.toLowerCase().includes("premiera")) formats.push("Premiéra");

  return compactFormats(formats);
}

function isLikelyMovieScreening(title: string, description: string) {
  return (
    MOVIE_FORMAT_TAG_RE.test(title) ||
    /\b(?:2D|3D|dabing|titulky|přístupné|\d{2}\+)\b/i.test(description)
  );
}

function compactFormats(formats: string[]) {
  const language = formats.find((format) => ["Titulky", "Dabing", "Originál"].includes(format));
  const projection = formats.find((format) => ["3D", "2D"].includes(format));

  return [language, projection].filter((format): format is string => Boolean(format));
}

function isDubbed(title: string, description: string) {
  return `${title} ${description}`.toLowerCase().includes("dabing") || DUBBING_TAG_RE.test(title);
}

function isOriginalVersion(title: string) {
  return /\bov\b/i.test(title) || title.includes("(OV)");
}

function detectsSubtitles(title: string, description: string) {
  return /titulky/i.test(description) || SUBTITLE_TAG_RE.test(title);
}

function firstUsefulDescription(screenings: RawScreening[]) {
  return screenings.find((screening) => screening.description)?.description ?? "Bez doplňujících informací.";
}

function cleanMovieDescription(description: string) {
  const redundant = new Set(["2D", "3D", "dabing", "titulky", "OV", "Originál"]);

  return description
    .split(",")
    .map((part) => cleanText(part))
    .filter((part) => part && !redundant.has(part))
    .join(", ");
}

function compareScreenings(left: RawScreening, right: RawScreening) {
  return left.sourceOrder - right.sourceOrder;
}

function cleanText(value = "") {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").replace(/&nbsp;/g, " ").trim();
}

function absolutize(value?: string | null) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, FIDIKO_BASE).toString();
  } catch {
    return null;
  }
}

function comparableTitle(value: string) {
  return normalizeFilmTitle(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(value: string) {
  return comparableTitle(value).replace(/\s+/g, "-") || "film";
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
