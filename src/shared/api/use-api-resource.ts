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

export function useApiResource<T>(
  url: string | null,
  retryToken: number,
  onOfflineChange: (offline: boolean) => void,
) {
  const requestId = useRef(0);
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

    if (cached) {
      setState({
        url,
        status: "ready",
        data: cached.data,
        error: null,
        refreshing: !cached.fresh,
      });
      onOfflineChange(cached.offline || !navigator.onLine);
      if (cached.fresh) return () => controller.abort();
    } else {
      setState(loadingState<T>(url));
    }

    void fetchJson<T>(url, controller.signal)
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
          error: error instanceof Error ? error.message : "Data se nepodařilo načíst.",
          refreshing: false,
        });
      });

    return () => controller.abort();
  }, [onOfflineChange, retryToken, url]);

  return visibleState;
}

