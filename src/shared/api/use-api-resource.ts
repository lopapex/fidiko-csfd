import { useEffect, useMemo, useRef, useState } from "react";
import { fetchJson, getCachedApi } from "./api";
import type { LoadState } from "../../types";

type ResourceState<T> = LoadState<T> & { url: string | null };

const loadingState = <T,>(url: string): ResourceState<T> => ({
  url,
  status: "loading",
  data: null,
  error: null,
  refreshing: false,
});

export const useApiResource = <T,>(
  url: string | null,
  retryToken: number,
  onOfflineChange: (offline: boolean) => void,
) => {
  const requestId = useRef(0);
  const lastRetryToken = useRef(retryToken);
  const [state, setState] = useState<ResourceState<T>>({
    ...loadingState<T>(url ?? ""),
    url,
  });

  const visibleState = useMemo<ResourceState<T>>(() => {
    if (!url || state.url === url) return state;
    const cached = getCachedApi<T>(url);
    return cached
      ? {
          url,
          status: "ready",
          data: cached.data,
          error: null,
          refreshing: !cached.fresh,
        }
      : loadingState<T>(url);
  }, [state, url]);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    const currentRequest = ++requestId.current;
    const cached = getCachedApi<T>(url);
    // A changed retry token (retry button, pull-to-refresh) always goes to the network.
    const forced = lastRetryToken.current !== retryToken;
    lastRetryToken.current = retryToken;

    if (cached) {
      setState({
        url,
        status: "ready",
        data: cached.data,
        error: null,
        refreshing: forced || !cached.fresh,
      });
      onOfflineChange(cached.offline || !navigator.onLine);
      if (cached.fresh && !forced) return () => controller.abort();
    } else {
      setState(loadingState<T>(url));
    }

    void fetchJson<T>(url, controller.signal, forced ? { cache: "no-cache" } : {})
      .then((result) => {
        if (currentRequest !== requestId.current) return;
        onOfflineChange(result.offline || !navigator.onLine);
        setState({
          url,
          status: "ready",
          data: result.data,
          error: null,
          refreshing: false,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (currentRequest !== requestId.current) return;
        setState({
          url,
          status: "error",
          data: cached?.data ?? null,
          // A failed connection surfaces as a TypeError with a browser-specific English text.
          error: error instanceof TypeError
            ? "Nepodařilo se připojit. Zkontrolujte připojení k internetu."
            : error instanceof Error ? error.message : "Data se nepodařilo načíst.",
          refreshing: false,
        });
      });

    return () => controller.abort();
  }, [onOfflineChange, retryToken, url]);

  return visibleState;
};

