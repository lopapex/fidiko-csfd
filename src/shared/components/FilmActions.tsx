import { CalendarPlus } from "lucide-react";
import {
  downloadPremiereIcs,
  downloadScreeningIcs,
  type CalendarPremiere,
  type CalendarScreening,
} from "../lib/calendar";
import { showToast } from "./Toast";

/** The one action the app offers: put a screening or a premiere into the calendar. */
export function CalendarButton({ screening }: { screening: CalendarScreening }) {
  if (!screening.time) return null;
  return (
    <button
      className="calendar-button"
      type="button"
      aria-label={`Přidat ${screening.title} ${screening.dateISO} ${screening.time} do kalendáře`}
      title="Přidat do kalendáře"
      onClick={() => {
        if (downloadScreeningIcs(screening)) showToast("Událost stažena do kalendáře");
      }}
    >
      <CalendarPlus size={16} aria-hidden="true" />
    </button>
  );
}

export function PremiereCalendarButton({ premiere }: { premiere: CalendarPremiere }) {
  return (
    <button
      className="calendar-button"
      type="button"
      aria-label={`Připomenout premiéru ${premiere.title} v kalendáři`}
      title="Připomenout premiéru v kalendáři"
      onClick={() => {
        if (downloadPremiereIcs(premiere)) showToast("Připomínka stažena do kalendáře");
      }}
    >
      <CalendarPlus size={16} aria-hidden="true" />
    </button>
  );
}
