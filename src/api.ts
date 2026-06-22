const FRESH_MS = 300_000;
const MAX_CACHE_ENTRIES = 24;

type CacheEntry<T> = {
  data: T;
  storedAt: number;
  offline: boolean;
};

export type ApiResult<T> = CacheEntry<T> & { fresh: boolean };

const memoryCache = new Map<string, CacheEntry<unknown>>();

export function getCachedApi<T>(url: string): ApiResult<T> | null {
  const entry = memoryCache.get(url) as CacheEntry<T> | undefined;
  if (!entry) return null;
  memoryCache.delete(url);
  memoryCache.set(url, entry);
  return { ...entry, fresh: Date.now() - entry.storedAt <= FRESH_MS };
}

export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  const response = await fetch(url, { signal });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("API není dostupné. Spusťte aplikaci přes Netlify Dev, ne pouze přes Vite.");
  }

  const body = await response.json() as T & { error?: string; detail?: string };
  if (!response.ok) {
    throw new Error(body.detail || body.error || `API odpovědělo chybou ${response.status}.`);
  }

  const entry: CacheEntry<T> = {
    data: body,
    storedAt: Date.now(),
    offline: response.headers.get("x-nzfd-offline") === "1" || !navigator.onLine
  };
  setCachedApi(url, entry);
  return { ...entry, fresh: true };
}

function setCachedApi<T>(url: string, entry: CacheEntry<T>) {
  memoryCache.delete(url);
  memoryCache.set(url, entry);
  while (memoryCache.size > MAX_CACHE_ENTRIES) {
    const oldest = memoryCache.keys().next().value as string | undefined;
    if (!oldest) break;
    memoryCache.delete(oldest);
  }
}

export function getApiCacheSize() {
  return memoryCache.size;
}

export function clearApiCache() {
  memoryCache.clear();
}
