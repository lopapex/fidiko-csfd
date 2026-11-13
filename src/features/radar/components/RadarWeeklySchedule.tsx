import type { RadarItem, RadarResponse } from "../../../types";
import { getPragueTodayISO, startOfWeek } from "../../../shared/state/page-state";
import { getWeekDays } from "../../../shared/lib/view-helpers";
import { WeekView, WeekViewSkeleton } from "../../../shared/components/WeekView";
import { RadarAgendaItem } from "./RadarCards";

export function RadarWeeklySchedule({
  data,
  items,
  selectedDay,
  onNavigate,
  onDayChange,
  onSelectProgramFilm,
}: {
  data: RadarResponse;
  items: RadarItem[];
  selectedDay: string | null;
  onNavigate: (week: string) => void;
  onDayChange: (day: string) => void;
  onSelectProgramFilm: (id: string) => void;
}) {
  const start = data.period.weekStart ?? data.period.start;
  const days = getWeekDays(start);

  const missing = data.status === "missing";
  const itemsForDay = (day: string) => (missing ? [] : items.filter(item => item.releaseDate === day));

  return (
    <>
    {missing ? (
      <div className="empty-box">{data.detail ?? "Radar pro tento týden zatím není připravený."}</div>
    ) : null}
    <WeekView
      idPrefix="radar"
      title="Premiéry na týden"
      days={days}
      today={getPragueTodayISO()}
      selectedDay={selectedDay}
      previousWeekStart={data.period.previousWeekStart}
      nextWeekStart={data.period.nextWeekStart}
      onNavigate={onNavigate}
      onDayChange={onDayChange}
      emptyDayText="Bez premiér"
      getDayMeta={day => ({ empty: itemsForDay(day).length === 0 })}
      renderDay={day =>
        itemsForDay(day).map((item, index) => (
          <RadarAgendaItem item={item} priority={index === 0} onSelectProgramFilm={onSelectProgramFilm} key={item.id} />
        ))
      }
    />
    </>
  );
}

export function RadarWeeklyLoading({ weekStart }: { weekStart: string | null }) {
  const days = getWeekDays(weekStart ?? startOfWeek(getPragueTodayISO()));
  return <WeekViewSkeleton days={days} label="Načítání radaru" />;
}
