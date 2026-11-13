export type NavDirection = "forward" | "back" | "none";

/**
 * Wrap a synchronous DOM update in the View Transitions API: sections turn like
 * pages ("forward" / "back", see animations.css), "none" crossfades. Browsers
 * without support, and users who prefer reduced motion, get the plain instant update.
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
  const transition = document.startViewTransition(update);
  // A transition can be skipped (hidden tab, a newer one started); the update itself still ran.
  transition.ready.catch(() => undefined);
  transition.finished
    .catch(() => undefined)
    .finally(() => {
      if (root.dataset.navDirection === direction) delete root.dataset.navDirection;
    });
};
