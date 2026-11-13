import { useCallback, useSyncExternalStore } from "react";

export const MOBILE_LAYOUT_QUERY = "(max-width: 760px)";

const getMediaQueryList = (query: string) =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query)
    : null;

export const useMediaQuery = (query: string) => {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = getMediaQueryList(query);
      list?.addEventListener("change", onChange);
      return () => list?.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => getMediaQueryList(query)?.matches ?? false,
    () => false,
  );
};

/** Render only the weekly layout the viewport needs instead of both hidden by CSS. */
export const useIsMobileLayout = () => useMediaQuery(MOBILE_LAYOUT_QUERY);
