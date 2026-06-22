import type { ReactNode } from "react";
import { LoadNotice } from "./LoadNotice";
import type { LoadState, RadarResponse } from "./types";

export function RadarView({
  load,
  offline,
  onRetry,
  renderLoading,
  renderSchedule,
}: {
  load: LoadState<RadarResponse>;
  offline: boolean;
  onRetry: () => void;
  renderLoading: () => ReactNode;
  renderSchedule: (data: RadarResponse) => ReactNode;
}) {
  return (
    <section className="radar-view" aria-label="Radar premiér">
      {offline && load.data ? (
        <div className="offline-banner" role="status">
          Offline radar, poslední data z {formatFetchedAt(load.data.fetchedAt)}.
        </div>
      ) : null}
      {load.status === "error" ? (
        <LoadNotice
          message={load.error ?? "Radar se nepodařilo načíst."}
          warning={Boolean(load.data)}
          onRetry={onRetry}
        />
      ) : null}
      {load.status === "loading" && !load.data
        ? renderLoading()
        : load.data
          ? renderSchedule(load.data)
          : null}
    </section>
  );
}

function formatFetchedAt(value: string) {
  return new Intl.DateTimeFormat("cs-CZ", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Prague",
  }).format(new Date(value));
}
