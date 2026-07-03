export type DeduplicableRadarItem = {
  id: string;
  tmdbId: number;
  mediaType: "movie" | "series";
  channel: "cinema" | "streaming";
  title: string;
  originalTitle: string | null;
  posterUrl: string | null;
  providers: Array<{ id: number }>;
  releaseDate: string;
  csfd: { title: string; url: string } | null;
};

export const deduplicateRadarItems = <T extends DeduplicableRadarItem>(items: T[]) => {
  const byKey = new Map<string, T>();
  const selected = new Set<T>();

  for (const item of items) {
    const keys = getRadarDeduplicationKeys(item);
    const existing = keys.map((key) => byKey.get(key)).find(Boolean);
    const selectedItem = existing && !shouldReplaceRadarItem(existing, item) ? existing : item;

    if (existing && selectedItem !== existing) selected.delete(existing);
    selected.add(selectedItem);
    for (const key of keys) byKey.set(key, selectedItem);
  }

  return [...selected.values()];
};

export const getRadarDeduplicationKeys = (item: DeduplicableRadarItem) => {
  const keys = item.csfd?.url ? [`csfd:${normalizeCsfdUrl(item.csfd.url)}`] : [];
  keys.push(...getCinemaTitleDeduplicationKeys(item));
  const streamingKey = getStreamingDeduplicationKey(item);
  if (streamingKey) keys.push(streamingKey);
  keys.push(...getStreamingTitleDeduplicationKeys(item));
  keys.push(`tmdb:${item.mediaType}:${item.channel}:${item.tmdbId}`);
  keys.push(`item:${item.id}`);
  return keys;
};

const getCinemaTitleDeduplicationKeys = (item: DeduplicableRadarItem) => {
  if (item.channel !== "cinema") return [];
  return getComparableTitles(item)
    .map((title) => `cinema-title:${item.mediaType}:${item.releaseDate}:${title}`);
};

const getStreamingDeduplicationKey = (item: DeduplicableRadarItem) => {
  if (item.channel !== "streaming" || item.providers.length === 0) return null;
  const poster = item.posterUrl ? normalizePosterUrl(item.posterUrl) : "no-poster";
  const providers = providerKey(item);
  return `streaming:${item.mediaType}:${item.releaseDate}:${poster}:${providers}`;
};

const getStreamingTitleDeduplicationKeys = (item: DeduplicableRadarItem) => {
  if (item.channel !== "streaming" || item.providers.length === 0) return [];
  const providers = providerKey(item);
  return getComparableTitles(item)
    .map((title) => `streaming-title:${item.mediaType}:${item.releaseDate}:${providers}:${title}`);
};

const shouldReplaceRadarItem = (existing: DeduplicableRadarItem, candidate: DeduplicableRadarItem) => {
  if (!existing.csfd?.url && Boolean(candidate.csfd?.url)) return true;
  if (existing.csfd?.url && !candidate.csfd?.url) return false;
  if (existing.tmdbId < 0 && candidate.tmdbId > 0) return true;
  if (!hasLocalizedTitle(existing) && hasLocalizedTitle(candidate)) return true;
  if (!existing.posterUrl && Boolean(candidate.posterUrl)) return true;
  return false;
};

export const normalizeCsfdUrl = (value: string) => {
  try {
    return normalizeCsfdPath(new URL(value).pathname);
  } catch {
    return normalizeCsfdPath(value.replace(/[?#].*$/, ""));
  }
};

export const normalizeRadarTitle = (value: string) =>
  value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const normalizeCsfdPath = (value: string) => {
  const path = value.replace(/\/$/, "");
  const match = path.match(/\/film\/(\d+)/);
  return match ? `/film/${match[1]}` : path;
};

const normalizePosterUrl = (value: string) =>
  value.replace(/\/cache\/resized\/w\d+(?:h\d+)?\//, "/cache/resized/");

const providerKey = (item: Pick<DeduplicableRadarItem, "providers">) =>
  item.providers.map((provider) => provider.id).sort((left, right) => left - right).join(",");

const getComparableTitles = (item: Pick<DeduplicableRadarItem, "title" | "originalTitle" | "csfd">) =>
  [...new Set([item.title, item.originalTitle, item.csfd?.title]
    .filter((value): value is string => Boolean(value))
    .map(normalizeRadarTitle)
    .filter(Boolean))];

const hasLocalizedTitle = (item: Pick<DeduplicableRadarItem, "title" | "originalTitle">) =>
  Boolean(item.originalTitle && normalizeRadarTitle(item.title) !== normalizeRadarTitle(item.originalTitle));
