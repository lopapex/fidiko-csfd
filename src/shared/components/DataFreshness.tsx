import { useEffect, useState } from "react";

const relativeFormatter = new Intl.RelativeTimeFormat("cs-CZ", { numeric: "auto" });

export const formatRelativeTime = (value: string, now = Date.now()) => {
  const diffMs = new Date(value).getTime() - now;
  if (!Number.isFinite(diffMs)) return null;
  const minutes = Math.round(diffMs / 60_000);
  if (Math.abs(minutes) < 1) return "právě teď";
  if (Math.abs(minutes) < 60) return relativeFormatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeFormatter.format(hours, "hour");
  return relativeFormatter.format(Math.round(hours / 24), "day");
};

/** "Program aktualizován před 3 hodinami" footer; re-renders every minute. */
export function DataFreshness({ label, fetchedAt }: { label: string; fetchedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!fetchedAt) return null;
  const relative = formatRelativeTime(fetchedAt, now);
  if (!relative) return null;
  const exact = new Intl.DateTimeFormat("cs-CZ", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Prague",
  }).format(new Date(fetchedAt));

  return (
    <p className="data-freshness">
      {label} <time dateTime={fetchedAt} title={exact}>{relative}</time>
    </p>
  );
}
