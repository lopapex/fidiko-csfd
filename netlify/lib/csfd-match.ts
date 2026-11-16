import type { CSFDMovie, CSFDSearchMovie } from "node-csfd-api";
import { csfdClient, type CsfdClient } from "./csfd-client";

/**
 * One way to pair a title with ČSFD, shared by the cinema program and the Radar.
 *
 *  1. Search ČSFD for every known title (localized, original, without subtitle).
 *  2. Score each result: how well the title fits, the year, the kind, the country.
 *  3. Open the best few and compare their alternative titles too.
 *  4. Take the best one that is sure enough.
 *
 * A network problem is reported as "error" and never as "not_found", so callers
 * can try again later instead of remembering a miss.
 */

export type CsfdKind = "movie" | "series";

export type CsfdLookupRequest = {
  /** Known titles, most trusted first. */
  titles: Array<string | null | undefined>;
  kind: CsfdKind;
  /** Expected release year; without it, recent titles are preferred slightly. */
  year?: number | null;
  /** Country names from the source; only real matches with ČSFD origins count. */
  countries?: string[];
  /** Year "now", for the recency preference (tests). */
  currentYear?: number;
};

export type CsfdLookupOutcome =
  | { status: "matched"; candidate: CSFDSearchMovie; details: CSFDMovie | null; confidence: number }
  | { status: "not_found" }
  | { status: "error" };

type Candidate = Pick<CSFDSearchMovie, "id" | "title" | "year" | "type"> & { origins?: string[] };
type Score = { title: number; confidence: number };

const MAX_QUERIES = 4;
const MAX_DETAIL_LOOKUPS = 3;
/** Title fit from which a candidate counts as "the same title". */
const SAME_TITLE = 90;
/** Fit of a candidate named exactly like the title without its subtitle. */
const SHORTENED_TITLE = 88;

export const comparableTitle = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const SUBTITLE_SEPARATOR = /\s*[:–—]\s+|\s+-\s+/;
const LEADING_ARTICLE = /^(?:the|a|an) /;

const splitSegments = (raw: string) =>
  raw.split(SUBTITLE_SEPARATOR).map(comparableTitle).filter(Boolean);

const significantWords = (value: string) => value.split(" ").filter((word) => word.length > 2);

function editDistance(left: string, right: string, limit: number) {
  if (Math.abs(left.length - right.length) > limit) return limit + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let best = row;
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + cost);
      best = Math.min(best, current[column]);
    }
    if (best > limit) return limit + 1;
    previous = current;
  }
  return previous[right.length];
}

/** "fanny a alexander" ~ "fanny a alexandr": same words, one long word spelled slightly differently. */
function isSpellingVariant(left: string, right: string) {
  const leftWords = left.split(" ");
  const rightWords = right.split(" ");
  if (leftWords.length !== rightWords.length || left.length < 8) return false;
  let different = 0;
  for (let index = 0; index < leftWords.length; index += 1) {
    const a = leftWords[index];
    const b = rightWords[index];
    if (a === b) continue;
    different += 1;
    // Short words and numbers tell films apart ("Rocky IV" / "Rocky V", "2" / "3").
    if (different > 1 || Math.min(a.length, b.length) < 5 || /\d/.test(a + b)) return false;
    if (editDistance(a, b, 1) > 1) return false;
  }
  return different === 1;
}

/**
 * How well two titles fit, 0–100:
 * 100 same · 96 same but for an article · 94 spelling variant ·
 * 78 nearly the same words · 72 one is the other plus a subtitle · 55 all words present · 0 unrelated.
 */
export function titleSimilarity(rawCandidate: string, rawQuery: string) {
  const candidate = comparableTitle(rawCandidate);
  const query = comparableTitle(rawQuery);
  if (!candidate || !query) return 0;
  if (candidate === query) return 100;
  if (candidate.replace(LEADING_ARTICLE, "") === query.replace(LEADING_ARTICLE, "")) return 96;
  if (isSpellingVariant(candidate, query)) return 94;

  const candidateWords = significantWords(candidate);
  const queryWords = significantWords(query);
  if (candidateWords.length > 0 && queryWords.length > 0) {
    const candidateSet = new Set(candidateWords);
    const querySet = new Set(queryWords);
    const queryCovered = queryWords.filter((word) => candidateSet.has(word)).length / queryWords.length;
    const candidateCovered = candidateWords.filter((word) => querySet.has(word)).length / candidateWords.length;
    if (queryWords.length > 1 && queryCovered >= 0.75 && candidateCovered >= 0.75) return 78;

    const candidateSegments = splitSegments(rawCandidate);
    const querySegments = splitSegments(rawQuery);
    const isSubtitleVariant =
      (candidateSegments.length > 1 && candidateSegments.includes(query)) ||
      (querySegments.length > 1 && querySegments.includes(candidate));
    if (isSubtitleVariant) return 72;

    if (queryWords.length > 1 && queryCovered >= 0.75) return 55;
  }
  return 0;
}

const COUNTRY_ALIASES: Record<string, string> = {
  "ceska republika": "cesko",
  "czech republic": "cesko",
  czechia: "cesko",
  "spojene staty": "usa",
  "spojene staty americke": "usa",
  "united states": "usa",
  "spojene kralovstvi": "velka britanie",
  "united kingdom": "velka britanie",
  uk: "velka britanie",
};

export const comparableCountry = (value: string) => {
  const normalized = comparableTitle(value);
  return COUNTRY_ALIASES[normalized] ?? normalized;
};

function kindAdjustment(type: string, kind: CsfdKind) {
  const isSeries = type === "series" || type === "tv-show";
  if (type === "episode") return null;
  if (kind === "series") return isSeries ? 8 : type === "season" ? 2 : null;
  if (type === "season") return null;
  if (isSeries) return -30;
  if (type === "film") return 8;
  if (type === "tv-film") return 4;
  if (type === "concert") return 0;
  // Stage recordings, student films, clips: possible, but a film of the same name wins.
  return -12;
}

function yearAdjustment(candidateYear: number, request: NormalizedRequest) {
  if (!Number.isFinite(candidateYear) || candidateYear <= 0) return 0;
  if (request.year == null) {
    if (candidateYear >= request.currentYear - 1) return 12;
    return candidateYear >= request.currentYear - 3 ? 6 : 0;
  }
  const difference = Math.abs(candidateYear - request.year);
  if (difference === 0) return 25;
  if (difference === 1) return 15;
  // A new season of an older series is normal; an old film under a new release date is not.
  if (request.kind === "series" && candidateYear < request.year) return 0;
  return difference === 2 ? 5 : -Math.min(40, difference * 8);
}

type NormalizedRequest = {
  titles: string[];
  /** Titles cut down to their main part; an exact hit on one is a good sign, not a proof. */
  shortenedTitles: string[];
  kind: CsfdKind;
  year: number | null;
  countries: Set<string>;
  currentYear: number;
};

function normalizeRequest(request: CsfdLookupRequest): NormalizedRequest {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const title of request.titles) {
    const comparable = title ? comparableTitle(title) : "";
    if (!comparable || seen.has(comparable)) continue;
    seen.add(comparable);
    titles.push(title!.trim());
  }
  const known = new Set(titles.map(comparableTitle));
  return {
    titles,
    shortenedTitles: buildCsfdQueries(titles).filter((query) => !known.has(comparableTitle(query))),
    kind: request.kind,
    year: typeof request.year === "number" && Number.isFinite(request.year) ? request.year : null,
    countries: new Set((request.countries ?? []).map(comparableCountry).filter(Boolean)),
    currentYear: request.currentYear ?? new Date().getFullYear(),
  };
}

/** Full titles first, then each title without its subtitle ("Vlny - Den boje…" → "Vlny"). */
export function buildCsfdQueries(titles: Array<string | null | undefined>) {
  const queries: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | null | undefined) => {
    const comparable = value ? comparableTitle(value) : "";
    if (comparable.length < 2 || seen.has(comparable)) return;
    seen.add(comparable);
    queries.push(value!.trim());
  };
  for (const title of titles) add(title);
  for (const title of titles) {
    const segments = title ? title.split(SUBTITLE_SEPARATOR).map((segment) => segment.trim()) : [];
    if (segments.length > 1 && comparableTitle(segments[0]).length >= 3) add(segments[0]);
  }
  return queries.slice(0, MAX_QUERIES);
}

/** Score a candidate against the request; `null` when it cannot be the title at all. */
export function scoreCsfdCandidate(
  candidate: Candidate,
  request: CsfdLookupRequest | NormalizedRequest,
  alternativeTitles: string[] = [],
  rank = 0,
): Score | null {
  const normalized = request.countries instanceof Set ? (request as NormalizedRequest) : normalizeRequest(request as CsfdLookupRequest);
  const kind = kindAdjustment(candidate.type, normalized.kind);
  if (kind === null) return null;

  let title = 0;
  for (const known of [candidate.title, ...alternativeTitles]) {
    for (const wanted of normalized.titles) {
      title = Math.max(title, titleSimilarity(known, wanted));
    }
    for (const shortened of normalized.shortenedTitles) {
      if (titleSimilarity(known, shortened) >= 96) title = Math.max(title, SHORTENED_TITLE);
    }
  }
  if (title === 0) return null;

  const sharesCountry = (candidate.origins ?? []).some((origin) => normalized.countries.has(comparableCountry(origin)));
  const confidence =
    title +
    kind +
    yearAdjustment(candidate.year, normalized) +
    (sharesCountry ? 20 : 0) +
    Math.max(0, 3 - rank);
  return { title, confidence };
}

/** The same title is enough on its own; a looser fit needs the year or country to agree as well. */
export const isAcceptableCsfdScore = (score: Score) =>
  score.title >= SAME_TITLE ? score.confidence >= 60 : score.confidence >= 100;

/** A result whose own title does not fit, but which may fit through an alternative title. */
function isWorthOpening(candidate: Candidate, request: NormalizedRequest, rank: number) {
  if (rank > 2 || kindAdjustment(candidate.type, request.kind) === null) return false;
  const isSeries = candidate.type === "series" || candidate.type === "tv-show" || candidate.type === "season";
  if ((request.kind === "series") !== isSeries) return false;
  return request.year == null
    ? candidate.year >= request.currentYear - 1
    : Math.abs(candidate.year - request.year) <= 1;
}

export async function resolveCsfdTitle(
  request: CsfdLookupRequest,
  client: CsfdClient = csfdClient,
): Promise<CsfdLookupOutcome> {
  const normalized = normalizeRequest(request);
  const queries = [...normalized.titles, ...normalized.shortenedTitles].slice(0, MAX_QUERIES);
  if (queries.length === 0) return { status: "not_found" };

  let failed = false;
  const ranks = new Map<number, { candidate: CSFDSearchMovie; rank: number }>();
  const opened = new Map<number, CSFDMovie | null>();

  for (const query of queries) {
    try {
      const result = await client.search(query);
      const ordered = normalized.kind === "series"
        ? [...result.tvSeries, ...result.movies]
        : [...result.movies, ...result.tvSeries];
      ordered.forEach((candidate, rank) => {
        if (!ranks.has(candidate.id)) ranks.set(candidate.id, { candidate, rank });
      });
    } catch (error) {
      failed = true;
      console.warn(`CSFD search failed for "${query}"`, error instanceof Error ? error.message : error);
      continue;
    }

    const entries = [...ranks.values()].map((entry) => ({
      ...entry,
      score: scoreCsfdCandidate(entry.candidate, normalized, [], entry.rank),
    }));
    const hasSameTitle = entries.some((entry) => entry.score && entry.score.title >= SAME_TITLE);
    const pool = entries
      .filter((entry) => entry.score || (!hasSameTitle && isWorthOpening(entry.candidate, normalized, entry.rank)))
      .map((entry) => ({
        ...entry,
        // The best this candidate can reach once its alternative titles are known.
        ceiling: (entry.score ? entry.score.confidence - entry.score.title : scoreWithoutTitle(entry.candidate, normalized, entry.rank)) + 100,
      }))
      .sort((left, right) => right.ceiling - left.ceiling || (right.score?.confidence ?? 0) - (left.score?.confidence ?? 0));

    let best: { candidate: CSFDSearchMovie; details: CSFDMovie | null; score: Score } | null = null;
    let lookups = 0;
    for (const entry of pool) {
      if (best && best.score.confidence >= entry.ceiling) break;
      if (lookups >= MAX_DETAIL_LOOKUPS) break;

      let details = opened.get(entry.candidate.id);
      if (details === undefined) {
        lookups += 1;
        try {
          details = await client.movie(entry.candidate.id);
        } catch (error) {
          failed = true;
          details = null;
          console.warn(`CSFD detail failed for "${entry.candidate.title}"`, error instanceof Error ? error.message : error);
        }
        opened.set(entry.candidate.id, details);
      }

      const score = details
        ? scoreCsfdCandidate(
            { ...entry.candidate, origins: details.origins?.length ? details.origins : entry.candidate.origins },
            normalized,
            [details.title, ...(details.titlesOther ?? []).map((other) => other.title)].filter(Boolean),
            entry.rank,
          )
        : entry.score;
      if (!score || !isAcceptableCsfdScore(score)) continue;
      if (!best || score.confidence > best.score.confidence) {
        best = { candidate: entry.candidate, details, score };
      }
    }

    if (best) {
      return { status: "matched", candidate: best.candidate, details: best.details, confidence: best.score.confidence };
    }
  }

  return failed ? { status: "error" } : { status: "not_found" };
}

function scoreWithoutTitle(candidate: Candidate, request: NormalizedRequest, rank: number) {
  return (kindAdjustment(candidate.type, request.kind) ?? 0) + yearAdjustment(candidate.year, request) + Math.max(0, 3 - rank);
}
