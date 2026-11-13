import type { CsfdMatch } from "../../types";
import { getCsfdLabel, getRatingClass } from "../lib/view-helpers";

/**
 * Compact ČSFD rating. Colors follow ČSFD's own convention (red ≥ 70 %,
 * blue ≥ 30 %, dark below); the rating count lives in the label, not on screen.
 */
export function RatingBadge({ title, csfd }: { title: string; csfd: CsfdMatch | null }) {
  const label = getCsfdLabel(title, csfd);
  const tone = csfd?.rating == null ? "rating-missing" : getRatingClass(csfd.rating);
  const text = csfd?.rating == null ? "–" : `${csfd.rating} %`;

  return csfd?.url ? (
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
  ) : (
    <span className={`rating ${tone}`} aria-label={label} title={label}>
      {text}
    </span>
  );
}
