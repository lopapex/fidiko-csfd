import * as cheerio from "cheerio";
import { csfd } from "node-csfd-api";

const FIDIKO_BASE = "https://www.fidiko.cz/";
const MAX_PAGES = 50;
const FETCH_TIMEOUT_MS = 12000;
const FETCH_RETRIES = 2;
const CSFD_TIMEOUT_MS = 3500;
const FORMAT_TAG_PATTERN = "(?:ÄŒT|ÄT|Ät|ČT|čt|CT|ct|ÄŒV|ÄV|Äv|ČV|čv|CV|cv|OV|ov|NES|nes|3D|3d|2D|2d)";
const FORMAT_TAG_GROUP_RE = new RegExp(`\\s*\\(\\s*${FORMAT_TAG_PATTERN}\\s*\\)`, "gi");
const SUBTITLE_TAG_RE = /\((?:\s*(?:ÄŒT|ÄT|Ät|ČT|čt|CT|ct)\s*)\)/i;
const DUBBING_TAG_RE = /\((?:\s*(?:ÄŒV|ÄV|Äv|ČV|čv|CV|cv)\s*)\)/i;
const MOVIE_FORMAT_TAG_RE = new RegExp(`\\(\\s*${FORMAT_TAG_PATTERN}\\s*\\)`, "i");
const TITLE_SUFFIX_RE =
  /\s+-\s+(?:PREMIÉRA|PREMIERA|PREMIÃ‰RA|Kino senior|Filmový klub|FilmovÃ½ klub|Dopoledn|TICHÁ STŘEDA|TICHA STREDA).*$/i;

type RawScreening = {
  id: string;
  sourceOrder: number;
  title: string;
  normalizedTitle: string;
  fidikoUrl: string;
  ticketUrl: string | null;
  posterUrl: string | null;
  dateText: string;
  dateLabel: string;
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

type FilmGroup = {
  id: string;
  title: string;
  posterUrl: string | null;
  description: string;
  hasSubtitles: boolean;
  csfd: CsfdMatch | null;
  screenings: RawScreening[];
};

const csfdCache = new Map<string, Promise<CsfdMatch | null>>();

export default async function handler() {
  try {
    const rawScreenings = await fetchAllScreenings();
    const groups = await groupScreenings(rawScreenings);

    return jsonResponse({
      fetchedAt: new Date().toISOString(),
      source: FIDIKO_BASE,
      totals: {
        films: groups.length,
        screenings: rawScreenings.length,
        withSubtitles: groups.filter((group) => group.hasSubtitles).length
      },
      films: groups
    });
  } catch (error) {
    console.error(error);

    return jsonResponse(
      {
        error: "Schedule could not be loaded",
        detail: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
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
      weekday: dateParts.weekday,
      time: dateParts.time,
      description,
      formats,
      hasSubtitles: detectsSubtitles(title, description)
    });
  });

  return screenings;
}

async function groupScreenings(screenings: RawScreening[]) {
  const map = new Map<string, RawScreening[]>();

  for (const screening of screenings) {
    const key = screening.normalizedTitle;
    const bucket = map.get(key) ?? [];
    bucket.push(screening);
    map.set(key, bucket);
  }

  const groups = await Promise.all(
    [...map.entries()].map(async ([title, items]) => {
      const sortedScreenings = items.sort(compareScreenings);
      const csfdMatch = await getCsfdMatch(title);

      return {
        id: slugify(title),
        title,
        posterUrl: sortedScreenings.find((screening) => screening.posterUrl)?.posterUrl ?? csfdMatch?.poster ?? null,
        description: cleanMovieDescription(firstUsefulDescription(sortedScreenings)),
        hasSubtitles: sortedScreenings.some((screening) => screening.hasSubtitles),
        csfd: csfdMatch,
        screenings: sortedScreenings
      } satisfies FilmGroup;
    })
  );

  return groups.sort((left, right) => compareScreenings(left.screenings[0], right.screenings[0]) || left.title.localeCompare(right.title, "cs"));
}

function getCsfdMatch(query: string) {
  const cached = csfdCache.get(query);
  if (cached) {
    return cached;
  }

  const promise = withTimeout(lookupCsfd(query), CSFD_TIMEOUT_MS, null);
  csfdCache.set(query, promise);
  return promise;
}

async function lookupCsfd(query: string): Promise<CsfdMatch | null> {
  try {
    const results = await csfd.search(query);
    const movies = Array.isArray(results) ? results : [...(results.movies ?? []), ...(results.tvSeries ?? [])];
    const normalizedQuery = comparableTitle(query);

    const match =
      movies.find((movie) => comparableTitle(movie.title) === normalizedQuery) ??
      movies.find((movie) => isPlausibleTitleMatch(comparableTitle(movie.title), normalizedQuery));

    if (!match) {
      return null;
    }

    const details = typeof match.id === "number" ? await getCsfdDetails(match.id) : null;

    return {
      title: details?.title ?? match.title,
      rating: numberOrNull(details?.rating) ?? numberOrNull(match.rating),
      ratingCount: numberOrNull(details?.ratingCount) ?? numberOrNull(match.ratingCount),
      url: details?.url ?? match.url ?? null,
      poster: details?.poster ?? match.poster ?? null
    };
  } catch (error) {
    console.warn(`CSFD lookup failed for "${query}"`, error);
    return null;
  }
}

async function getCsfdDetails(id: number) {
  try {
    return await csfd.movie(id);
  } catch {
    return null;
  }
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

function normalizeFilmTitle(title: string) {
  return cleanText(
    title
      .replace(FORMAT_TAG_GROUP_RE, "")
      .replace(TITLE_SUFFIX_RE, "")
      .replace(/\s+/g, " ")
  );
}

function extractFormats(title: string, description: string) {
  const formats: string[] = [];
  const combined = `${title} ${description}`.toLowerCase();

  if (detectsSubtitles(title, description)) {
    formats.push("Titulky");
  } else if (isDubbed(title, description)) {
    formats.push("Dabing");
  } else if (isOriginalVersion(title)) {
    formats.push("OV");
  }
  if (combined.includes("dabing") || DUBBING_TAG_RE.test(title)) formats.push("Dabing");
  if (combined.includes("2d")) formats.push("2D");
  if (combined.includes("3d")) formats.push("3D");
  if (/\bov\b/i.test(title) || title.includes("(OV)")) formats.push("OV");
  if (title.includes("Kino senior")) formats.push("Kino senior");
  if (title.includes("FilmovÃ½ klub")) formats.push("FilmovÃ½ klub");
  if (title.toLowerCase().includes("premiÃ©ra") || title.toLowerCase().includes("premiera")) formats.push("PremiÃ©ra");

  return compactFormats(formats);
}

function isLikelyMovieScreening(title: string, description: string) {
  return (
    MOVIE_FORMAT_TAG_RE.test(title) ||
    /\b(?:2D|3D|dabing|titulky|pÅ™Ã­stupnÃ©|\d{2}\+)\b/i.test(description)
  );
}

function compactFormats(formats: string[]) {
  const language = formats.find((format) => ["Titulky", "Dabing", "OV"].includes(format));
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
  return screenings.find((screening) => screening.description)?.description ?? "Bez doplÅˆujÃ­cÃ­ch informacÃ­.";
}

function cleanMovieDescription(description: string) {
  const redundant = new Set(["2D", "3D", "dabing", "titulky", "OV"]);

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
  return value.replace(/\s+/g, " ").replace(/&nbsp;/g, " ").trim();
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

function isPlausibleTitleMatch(candidate: string, query: string) {
  if (!candidate || !query) {
    return false;
  }

  if (candidate.includes(query) || query.includes(candidate)) {
    return true;
  }

  const candidateWords = new Set(candidate.split(" ").filter((word) => word.length > 2));
  const queryWords = query.split(" ").filter((word) => word.length > 2);
  const matches = queryWords.filter((word) => candidateWords.has(word)).length;

  return queryWords.length > 0 && matches / queryWords.length >= 0.75;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
