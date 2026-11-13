import { useEffect, useRef, useState } from "react";

const THRESHOLD_PX = 72;
const MAX_PULL_PX = 110;

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/**
 * Pull-to-refresh for the installed PWA, where browsers offer none. In a normal
 * browser tab the native gesture (page reload) stays in charge.
 */
export const usePullToRefresh = (onRefresh: () => void) => {
  const [pull, setPull] = useState(0);
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (!isStandalone()) return;
    document.documentElement.classList.add("standalone-app");

    const onTouchStart = (event: TouchEvent) => {
      startY.current = window.scrollY <= 0 && event.touches.length === 1 ? event.touches[0].clientY : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (startY.current === null) return;
      const delta = event.touches[0].clientY - startY.current;
      if (delta <= 0 || window.scrollY > 0) {
        pullRef.current = 0;
        setPull(0);
        return;
      }
      // Resistance: the indicator moves slower than the finger.
      pullRef.current = Math.min(MAX_PULL_PX, delta * 0.5);
      setPull(pullRef.current);
    };
    const onTouchEnd = () => {
      if (pullRef.current >= THRESHOLD_PX * 0.75) onRefreshRef.current();
      startY.current = null;
      pullRef.current = 0;
      setPull(0);
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  return { pull, ready: pull >= THRESHOLD_PX * 0.75 };
};
