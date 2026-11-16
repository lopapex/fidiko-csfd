import type { RadarItem, RadarResponse } from "../../../types";
import { getPragueTodayISO, startOfWeek } from "../../../shared/state/page-state";
import { getWeekDays } from "../../../shared/lib/view-helpers";
import { WeekView, WeekViewSkeleton, type WeekContent } from "../../../shared/components/WeekView";
import { RadarAgendaItem } from "./RadarCards";

export function RadarWeeklySchedule({
  data,
  items,
  getWeekItems,
  selectedDay,
  landOnSelectedDay,
  onNavigate,
  onDayChange,
  onSelectProgramFilm,
}: {
  data: RadarResponse;
  items: RadarItem[];
  /** Items of another week if already loaded (cache), for the neighbours revealed while swiping. */
  getWeekItems: (weekStart: string) => RadarItem[] | null;
  selectedDay: string | null;
  landOnSelectedDay: boolean;
  onNavigate: (week: string) => void;
  onDayChange: (day: string) => void;
  onSelectProgramFilm: (id: string) => void;
}) {
  const start = data.period.weekStart ?? data.period.start;
  const { previousWeekStart, nextWeekStart } = data.period;
  const missing = data.status === "missing";

  const toContent = (weekStart: string, weekItems: RadarItem[], interactive: boolean, notice?: string): WeekContent => {
    const itemsForDay = (day: string) => weekItems.filter(item => item.releaseDate === day);
    return {
      days: getWeekDays(weekStart),
      notice: notice ?? (weekItems.length === 0 ? "Tento týden žádné premiéry." : undefined),
      getDayMeta: day => ({ empty: itemsForDay(day).length === 0 }),
      renderDay: day =>
        itemsForDay(day).map((item, index) => (
          <RadarAgendaItem
            item={item}
            priority={interactive && index === 0}
            onSelectProgramFilm={onSelectProgramFilm}
            key={item.id}
          />
        )),
    };
  };
  const neighbour = (weekStart: string | null) => {
    const weekItems = weekStart ? getWeekItems(weekStart) : null;
    return weekStart && weekItems ? toContent(weekStart, weekItems, false) : null;
  };

  return (
    <>
      <WeekView
        idPrefix="radar"
        title="Premiéry na týden"
        today={getPragueTodayISO()}
        selectedDay={selectedDay}
        landOnSelectedDay={landOnSelectedDay}
        current={toContent(
          start,
          missing ? [] : items,
          true,
          missing ? "Premiéry pro tento týden se teprve připravují." : undefined,
        )}
        previous={neighbour(previousWeekStart)}
        next={neighbour(nextWeekStart)}
        previousWeekStart={previousWeekStart}
        nextWeekStart={nextWeekStart}
        onNavigate={onNavigate}
        onDayChange={onDayChange}
        emptyDayText="Bez premiér"
      />
    </>
  );
}

export function RadarWeeklyLoading({ weekStart }: { weekStart: string | null }) {
  const days = getWeekDays(weekStart ?? startOfWeek(getPragueTodayISO()));
  return <WeekViewSkeleton days={days} label="Načítání radaru" />;
}
