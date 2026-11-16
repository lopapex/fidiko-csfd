import type { CsfdMatch } from "../../types";
import { getCsfdLabel, getRatingClass } from "../lib/view-helpers";

/**
 * Compact ČSFD rating. Colors follow ČSFD's own convention (red ≥ 70 %,
 * blue ≥ 30 %, dark below); the rating count lives in the label, not on screen.
 */
export function RatingBadge({ title, csfd }: { title: string; csfd: CsfdMatch | null }) {
  // Not on ČSFD at all: say nothing rather than show an empty badge.
  if (!csfd?.url) return null;
  const label = getCsfdLabel(title, csfd);
  // On ČSFD but not rated yet (before the premiere): still a way to the film's page.
  const tone = csfd.rating == null ? "rating-missing" : getRatingClass(csfd.rating);
  const text = csfd.rating == null ? "ČSFD" : `${csfd.rating} %`;

  return (
    <a
      className={`rating ${tone}`}
      href={csfd.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
    >
      {text}
    </a>
  );
}
