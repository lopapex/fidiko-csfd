import type { ReactNode } from "react";
import { LoadNotice } from "./LoadNotice";
import type { FilmGroup, LoadState, ScheduleResponse, ViewMode } from "./types";

export function ProgramView({
  view,
  load,
  films,
  filtersActive,
  offline,
  toolbar,
  onRetry,
  renderLoading,
  renderWeekly,
  renderFilm,
}: {
  view: ViewMode;
  load: LoadState<ScheduleResponse>;
  films: FilmGroup[];
  filtersActive: boolean;
  offline: boolean;
  toolbar: ReactNode;
  onRetry: () => void;
  renderLoading: (view: ViewMode) => ReactNode;
  renderWeekly: (data: ScheduleResponse, films: FilmGroup[]) => ReactNode;
  renderFilm: (film: FilmGroup, index: number) => ReactNode;
}) {
  return (
    <>
      {view === "all" ? toolbar : null}
      {offline && load.data ? (
        <div className="offline-banner" role="status">
          Offline program, poslední data z {formatFetchedAt(load.data.fetchedAt)}.
        </div>
      ) : null}
      {load.status === "error" ? (
        <LoadNotice
          message={load.error ?? "Program se nepodařilo načíst."}
          warning={Boolean(load.data)}
          onRetry={onRetry}
        />
      ) : null}
      {load.status === "loading" && !load.data ? (
        renderLoading(view)
      ) : load.data && view === "week" ? (
        renderWeekly(load.data, films)
      ) : load.data && films.length > 0 ? (
        <section className="program-list" aria-label="Program filmů">
          {films.map(renderFilm)}
        </section>
      ) : load.data ? (
        <div className="empty-box">
          {filtersActive
            ? "Žádná projekce neodpovídá vybraným filtrům."
            : "Momentálně tu není žádný program kina."}
        </div>
      ) : null}
    </>
  );
}

function formatFetchedAt(value: string) {
  return new Intl.DateTimeFormat("cs-CZ", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Prague",
  }).format(new Date(value));
}
