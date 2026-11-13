import { flushSync } from "react-dom";

export type NavDirection = "forward" | "back" | "none";

/**
 * Wrap a React state update in the View Transitions API (crossfade, or a
 * horizontal slide for week navigation). Browsers without support, and users
 * who prefer reduced motion, get the plain instant update.
 */
export const runViewTransition = (update: () => void, direction: NavDirection = "none") => {
  if (
    typeof document === "undefined" ||
    typeof document.startViewTransition !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    update();
    return;
  }

  const root = document.documentElement;
  root.dataset.navDirection = direction;
  const transition = document.startViewTransition(() => flushSync(update));
  transition.finished
    .catch(() => undefined)
    .finally(() => {
      if (root.dataset.navDirection === direction) delete root.dataset.navDirection;
    });
};
