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

type StreamingProviderApplication = {
  item: RadarItem;
  evidence: "csfd_vod" | "disney_tv_fallback" | "disney_tmdb_fallback";
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

  return publish({ ...candidate, item: published.item, evidence: [...candidate.evidence, published.evidence] });
};

const applyCsfdStreamingProvider = (item: RadarItem, rangeStart: string, rangeEnd: string): StreamingProviderApplication | null => {
  const premieresInRange = (item.csfd?.vodPremieres ?? [])
    .filter((premiere) => premiere.date >= rangeStart && premiere.date <= rangeEnd);
  if (premieresInRange.length > 0) {
    const csfdProviders = createProvidersFromCsfdPremieres(premieresInRange, item.title);
    const providers = filterDisabledProvidersWhenClickable(hasAnyClickableProvider(csfdProviders)
      ? csfdProviders
      : mergeProviders(csfdProviders, item.providers.filter(hasClickableProvider)));
    if (providers.length === 0) return null;
    return {
      item: createStreamingItemWithProviders(item, premieresInRange[0].date, providers),
      evidence: "csfd_vod",
    };
  }

  return applyDisneyStreamingFallback(item, rangeStart, rangeEnd);
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

const hasClickableProvider = (provider: RadarProvider) => Boolean(provider.url);

const hasAnyClickableProvider = (providers: RadarProvider[]) => providers.some(hasClickableProvider);

const filterDisabledProvidersWhenClickable = (providers: RadarProvider[]) =>
  hasAnyClickableProvider(providers) ? providers.filter(hasClickableProvider) : providers;

const mergeProviders = (primary: RadarProvider[], fallback: RadarProvider[]) => {
  const unique = new Map<number, RadarProvider>();
  for (const provider of [...primary, ...fallback]) {
    unique.set(provider.id, provider);
  }
  return [...unique.values()];
};

const applyDisneyStreamingFallback = (
  item: RadarItem,
  rangeStart: string,
  rangeEnd: string
): StreamingProviderApplication | null => {
  if (!isDisneyCandidate(item)) return null;
  const releaseDate = item.csfd?.releaseDate && item.csfd.releaseDate >= rangeStart && item.csfd.releaseDate <= rangeEnd
    ? item.csfd.releaseDate
    : item.releaseDate;
  if (releaseDate < rangeStart || releaseDate > rangeEnd) return null;
  const provider = createDisneyPlusProvider(item.title);
  if (!provider) return null;
  return {
    item: createStreamingItemWithProviders(item, releaseDate, [provider]),
    evidence: item.csfd?.releaseDate === releaseDate ? "disney_tv_fallback" : "disney_tmdb_fallback",
  };
};

const createStreamingItemWithProviders = (item: RadarItem, releaseDate: string, providers: RadarProvider[]) => ({
  ...item,
  id: `${item.mediaType}-${item.tmdbId}-${item.channel}-${releaseDate}`,
  releaseDate,
  providers,
}) satisfies RadarItem;

const createDisneyPlusProvider = (title: string): RadarProvider | null => {
  const metadata = getProviderMetadata("Disney Plus");
  if (!metadata?.logoPath) return null;
  return {
    id: metadata.id,
    name: metadata.name,
    logoUrl: `${TMDB_IMAGE_BASE}/w45${metadata.logoPath}`,
    ...getProviderLink(metadata.name, title),
  };
};

const isDisneyCandidate = (item: RadarItem) => {
  if (item.providers.some((provider) => /disney/i.test(provider.name))) return true;
  return [item.title, item.originalTitle, item.csfd?.title]
    .filter((value): value is string => Boolean(value))
    .some((value) => /\b(?:descendants|n[aá]sledn[ií]ci|camp rock|zombies|cheetah girls)\b/i.test(value));
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
