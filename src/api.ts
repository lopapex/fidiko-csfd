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
  const response = await fetchWithDevFallback(url, signal);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(createNonJsonApiError(response, url));
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

async function fetchWithDevFallback(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return response;
  }

  const fallbackUrl = getLocalNetlifyApiUrl(url);
  if (!fallbackUrl) return response;

  try {
    const fallbackResponse = await fetch(fallbackUrl, { signal });
    if (fallbackResponse.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      return fallbackResponse;
    }
  } catch {
    // Keep the original response so the user sees the existing Netlify Dev guidance.
  }

  return response;
}

function getLocalNetlifyApiUrl(url: string) {
  if (!import.meta.env.DEV || !url.startsWith("/api/")) return null;
  const location = globalThis.location;
  if (!location || !["localhost", "127.0.0.1"].includes(location.hostname) || location.port === "8888") {
    return null;
  }
  return `http://localhost:8888${url}`;
}

function createNonJsonApiError(response: Response, url: string) {
  if (import.meta.env.DEV && url.startsWith("/api/")) {
    return "API není dostupné. Spusťte aplikaci přes Netlify Dev, ne pouze přes Vite.";
  }
  return `API vrátilo neplatnou odpověď (${response.status}). Zkuste stránku obnovit; pokud problém trvá, zkontrolujte nasazení Netlify Functions.`;
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
