import { getProviderLink, getProviderMetadata } from "./radar-providers";
import { TMDB_IMAGE_BASE } from "./radar-tmdb";
import { deduplicateRadarItems } from "./radar-deduplication";
import type { RadarItem, RadarProvider } from "./radar-refresh";
import type { RadarCsfdMatch } from "./radar-csfd";

export type RadarCandidateStage = "discover" | "resolve" | "enrich" | "decide" | "publish";
export type RadarRejectReason =
  | "no_csfd_match"
  | "episode_match"
  | "no_csfd_vod"
  | "outside_week"
  | "duplicate";

export type RadarCandidate = {
  item: RadarItem;
  source: string;
  sourceId: string;
  mediaType: RadarItem["mediaType"];
  channel: RadarItem["channel"];
  candidateDate: string;
  stage: RadarCandidateStage;
  evidence: string[];
  rejectReason: RadarRejectReason | null;
};

export type RadarDecisionDiagnostics = {
  discovered: number;
  resolved: number;
  published: number;
  rejectedByReason: Partial<Record<RadarRejectReason, number>>;
};

export type RadarDecisionResult = {
  items: RadarItem[];
  diagnostics: RadarDecisionDiagnostics;
};

export const prepareRadarItemsForSnapshot = (
  items: RadarItem[],
  rangeStart: string,
  rangeEnd: string,
): RadarItem[] => decideRadarItemsForSnapshot(items, rangeStart, rangeEnd).items;

export const decideRadarItemsForSnapshot = (
  items: RadarItem[],
  rangeStart: string,
  rangeEnd: string,
): RadarDecisionResult => {
  const candidates = items.map(createCandidate);
  const decided = candidates.map((candidate) => decideCandidate(candidate, rangeStart, rangeEnd));
  const publishable = decided
    .filter((candidate) => candidate.rejectReason === null)
    .map((candidate) => candidate.item);
  const deduped = deduplicateRadarItems(publishable);
  const duplicateCount = Math.max(0, publishable.length - deduped.length);
  const rejectedByReason = countRejects(decided);
  if (duplicateCount > 0) rejectedByReason.duplicate = (rejectedByReason.duplicate ?? 0) + duplicateCount;

  return {
    items: deduped,
    diagnostics: {
      discovered: candidates.length,
      resolved: decided.filter((candidate) => candidate.stage !== "discover").length,
      published: deduped.length,
      rejectedByReason,
    },
  };
};

const decideCandidate = (candidate: RadarCandidate, rangeStart: string, rangeEnd: string): RadarCandidate => {
  const item = candidate.item;
  if (item.mediaType === "series" && item.csfd && isEpisodeCsfdMatch(item.csfd)) {
    return reject(candidate, "episode_match");
  }

  if (item.channel === "cinema") {
    return item.releaseDate >= rangeStart && item.releaseDate <= rangeEnd
      ? publish(candidate)
      : reject(candidate, "outside_week");
  }

  if (!item.csfd?.url) return reject(candidate, "no_csfd_match");
  const published = applyCsfdStreamingProvider(item, rangeStart, rangeEnd);
  if (!published) {
    const hasVodInRange = (item.csfd.vodPremieres ?? []).some((premiere) => premiere.date >= rangeStart && premiere.date <= rangeEnd);
    return reject(candidate, hasVodInRange ? "no_csfd_vod" : "outside_week");
  }

  return publish({ ...candidate, item: published, evidence: [...candidate.evidence, "csfd_vod"] });
};

const applyCsfdStreamingProvider = (item: RadarItem, rangeStart: string, rangeEnd: string) => {
  const premieresInRange = (item.csfd?.vodPremieres ?? [])
    .filter((premiere) => premiere.date >= rangeStart && premiere.date <= rangeEnd);
  if (premieresInRange.length === 0) return null;
  const providers = createProvidersFromCsfdPremieres(premieresInRange, item.title);
  if (providers.length === 0) return null;
  const releaseDate = premieresInRange[0].date;
  return {
    ...item,
    id: `${item.mediaType}-${item.tmdbId}-${item.channel}-${releaseDate}`,
    releaseDate,
    providers,
  } satisfies RadarItem;
};

const createProvidersFromCsfdPremieres = (premieres: RadarCsfdMatch["vodPremieres"], title: string) => {
  const unique = new Map<number, RadarProvider>();
  for (const premiere of premieres) {
    const metadata = getProviderMetadata(premiere.provider);
    if (!metadata) continue;
    unique.set(metadata.id, {
      id: metadata.id,
      name: metadata.name,
      logoUrl: metadata.logoPath ? `${TMDB_IMAGE_BASE}/w45${metadata.logoPath}` : null,
      ...getProviderLink(metadata.name, title),
    });
  }
  return [...unique.values()];
};

const createCandidate = (item: RadarItem): RadarCandidate => ({
  item,
  source: item.tmdbId < 0 ? "csfd_manual_override" : "tmdb",
  sourceId: String(Math.abs(item.tmdbId)),
  mediaType: item.mediaType,
  channel: item.channel,
  candidateDate: item.releaseDate,
  stage: "decide",
  evidence: [
    item.tmdbId < 0 ? "csfd_seed" : "tmdb_candidate",
    item.csfd?.url ? "csfd_match" : "no_csfd_match",
    item.providers.length > 0 ? "provider_signal" : "no_provider_signal",
  ],
  rejectReason: null,
});

const publish = (candidate: RadarCandidate): RadarCandidate => ({
  ...candidate,
  stage: "publish",
  rejectReason: null,
});

const reject = (candidate: RadarCandidate, rejectReason: RadarRejectReason): RadarCandidate => ({
  ...candidate,
  stage: "decide",
  rejectReason,
});

const countRejects = (candidates: RadarCandidate[]) =>
  candidates.reduce<Partial<Record<RadarRejectReason, number>>>((counts, candidate) => {
    if (!candidate.rejectReason) return counts;
    counts[candidate.rejectReason] = (counts[candidate.rejectReason] ?? 0) + 1;
    return counts;
  }, {});

const isEpisodeCsfdMatch = (csfd: { title: string; url: string }) =>
  isNestedCsfdEpisodeUrl(csfd.url) || /\b(?:episode|epizoda)\s+\d+\b/i.test(csfd.title);

const isNestedCsfdEpisodeUrl = (url: string) =>
  /\/film\/\d+(?:-[^/]+)?\/\d+-(?:episode|epizoda)[^/]*\//i.test(url);
