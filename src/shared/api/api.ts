const FRESH_MS = 300_000;
const MAX_CACHE_ENTRIES = 24;
// Last responses survive reloads so a cold start paints instantly and revalidates in the background.
const PERSIST_PREFIX = "nzfd-api-v1:";
const MAX_PERSISTED_ENTRIES = 6;
const PERSIST_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
// The full program is what the app opens on; radar weeks must never evict it.
const PINNED_PERSIST_KEYS = new Set([`${PERSIST_PREFIX}/api/schedule`]);

type CacheEntry<T> = {
  data: T;
  storedAt: number;
  offline: boolean;
};

export type ApiResult<T> = CacheEntry<T> & { fresh: boolean };

const memoryCache = new Map<string, CacheEntry<unknown>>();

export function getCachedApi<T>(url: string): ApiResult<T> | null {
  let entry = memoryCache.get(url) as CacheEntry<T> | undefined;
  if (!entry) {
    entry = readPersistedApi<T>(url) ?? undefined;
    if (!entry) return null;
  }
  memoryCache.delete(url);
  memoryCache.set(url, entry);
  return { ...entry, fresh: Date.now() - entry.storedAt <= FRESH_MS };
}

export async function fetchJson<T>(
  url: string,
  signal?: AbortSignal,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  const response = await fetchWithDevFallback(url, signal, init);
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
    offline: response.headers.get("x-nzfd-offline") === "1" || !navigator.onLine,
  };
  if (!response.headers.get("cache-control")?.toLowerCase().includes("no-store")) {
    setCachedApi(url, entry);
  }
  return { ...entry, fresh: true };
}

export function storeApiResult<T>(url: string, result: ApiResult<T>) {
  setCachedApi(url, {
    data: result.data,
    storedAt: result.storedAt,
    offline: result.offline,
  });
}

async function fetchWithDevFallback(url: string, signal?: AbortSignal, init: RequestInit = {}) {
  const requestInit = { ...init, signal };
  const response = await fetch(url, requestInit);
  if (response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return response;
  }

  const fallbackUrl = getLocalNetlifyApiUrl(url);
  if (!fallbackUrl) return response;

  try {
    const fallbackResponse = await fetch(fallbackUrl, requestInit);
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
  persistApi(url, entry);
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
  try {
    for (const key of getPersistedKeys()) localStorage.removeItem(key);
  } catch {
    // Persistence is optional.
  }
}

function readPersistedApi<T>(url: string): CacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(PERSIST_PREFIX + url);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (typeof entry?.storedAt !== "number" || Date.now() - entry.storedAt > PERSIST_MAX_AGE_MS) {
      localStorage.removeItem(PERSIST_PREFIX + url);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function persistApi<T>(url: string, entry: CacheEntry<T>) {
  try {
    localStorage.setItem(PERSIST_PREFIX + url, JSON.stringify(entry));
    const keys = getPersistedKeys().filter(key => !PINNED_PERSIST_KEYS.has(key));
    if (keys.length <= MAX_PERSISTED_ENTRIES) return;
    const byAge = keys
      .map(key => ({ key, storedAt: readStoredAt(key) }))
      .sort((left, right) => left.storedAt - right.storedAt);
    for (const { key } of byAge.slice(0, keys.length - MAX_PERSISTED_ENTRIES)) {
      localStorage.removeItem(key);
    }
  } catch {
    // Quota exceeded or storage blocked: the in-memory cache still works.
  }
}

function getPersistedKeys() {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(PERSIST_PREFIX)) keys.push(key);
  }
  return keys;
}

function readStoredAt(key: string) {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "{}") as { storedAt?: number }).storedAt ?? 0;
  } catch {
    return 0;
  }
}
