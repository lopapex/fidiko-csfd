import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatDayLabel, formatShortDate, formatWeekRange, formatWeekday } from "../lib/view-helpers";

export type DayMeta = { empty: boolean; hasSubtitles?: boolean };

type Props = {
  idPrefix: string;
  title: string;
  days: string[];
  today: string;
  selectedDay: string | null;
  previousWeekStart: string | null;
  nextWeekStart: string | null;
  onNavigate: (week: string) => void;
  onDayChange?: (day: string) => void;
  getDayMeta: (day: string) => DayMeta;
  renderDay: (day: string) => ReactNode;
  emptyDayText: string;
};

const SWIPE_MIN_PX = 70;
const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** One week layout everywhere: sticky day strip + days stacked; items form a grid on wide screens. */
export function WeekView(props: Props) {
  return <WeekAgenda {...props} />;
}

function WeekNavButton({
  direction,
  week,
  onNavigate,
}: {
  direction: "previous" | "next";
  week: string | null;
  onNavigate: (week: string) => void;
}) {
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;
  const label = direction === "previous" ? "Předchozí týden" : "Další týden";
  return (
    <button
      className="week-arrow"
      type="button"
      disabled={!week}
      onClick={() => week && onNavigate(week)}
      aria-label={label}
      title={label}
    >
      <Icon size={22} aria-hidden="true" />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Phones and tablets: one list, sticky day strip, swipe between weeks */
/* ------------------------------------------------------------------ */

function WeekAgenda({
  idPrefix,
  title,
  days,
  today,
  selectedDay,
  previousWeekStart,
  nextWeekStart,
  onNavigate,
  onDayChange,
  getDayMeta,
  renderDay,
  emptyDayText,
}: Props) {
  const rootRef = useRef<HTMLElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const scrolledWeek = useRef<string | null>(null);
  const spyLockedUntil = useRef(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const weekKey = days[0] ?? "";
  const [activeDay, setActiveDay] = useState<string | null>(selectedDay);
  const dayId = (day: string) => `${idPrefix}-day-${day}`;

  // Land on the selected day (today, or the first day with a program) once per week.
  useEffect(() => {
    if (!selectedDay || !days.includes(selectedDay) || scrolledWeek.current === weekKey) return;
    scrolledWeek.current = weekKey;
    setActiveDay(selectedDay);
    const frame = window.requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;
      if (selectedDay === days[0]) {
        const top = root.getBoundingClientRect().top + window.scrollY;
        if (window.scrollY > top) window.scrollTo({ top });
        return;
      }
      spyLockedUntil.current = Date.now() + 400;
      document.getElementById(dayId(selectedDay))?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
    // `days` and `dayId` are fully determined by `weekKey` and `idPrefix`.
  }, [selectedDay, weekKey]);

  // Scroll-spy: the strip highlights the day currently under it.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (Date.now() < spyLockedUntil.current) return;
      const stripBottom = stripRef.current?.getBoundingClientRect().bottom ?? 0;
      let current = days[0];
      for (const day of days) {
        const section = document.getElementById(dayId(day));
        if (section && section.getBoundingClientRect().top <= stripBottom + 4) current = day;
      }
      setActiveDay(previous => (previous === current ? previous : current));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
    // Re-subscribed per week; `days` is fully determined by `weekKey`.
  }, [weekKey]);

  const jumpToDay = (day: string) => {
    setActiveDay(day);
    onDayChange?.(day);
    spyLockedUntil.current = Date.now() + 900;
    document.getElementById(dayId(day))?.scrollIntoView({
      block: "start",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  };

  return (
    <section
      className="week-view week-agenda weekly-mobile"
      ref={rootRef}
      aria-label={`${title}: ${formatWeekRange(days[0] ?? null, days[6] ?? null)}`}
      onTouchStart={event => {
        const touch = event.touches[0];
        touchStart.current = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
      }}
      onTouchEnd={event => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start) return;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 2) return;
        const target = dx < 0 ? nextWeekStart : previousWeekStart;
        if (target) onNavigate(target);
      }}
    >
      <div className="week-strip" ref={stripRef}>
        <WeekNavButton direction="previous" week={previousWeekStart} onNavigate={onNavigate} />
        <div className="week-strip-days" role="group" aria-label="Dny v týdnu">
          {days.map(day => {
            const meta = getDayMeta(day);
            const className = [
              "week-strip-day",
              day === today ? "today" : "",
              meta.empty ? "empty" : "",
              meta.hasSubtitles ? "has-subtitles" : "",
            ].filter(Boolean).join(" ");
            return (
              <button
                className={className}
                type="button"
                aria-current={day === activeDay ? "true" : undefined}
                aria-label={`${formatDayLabel(day)}${meta.empty ? `, ${emptyDayText.toLocaleLowerCase("cs-CZ")}` : ""}`}
                onClick={() => jumpToDay(day)}
                key={day}
              >
                <span>{formatWeekday(day)}</span>
                <strong>{formatShortDate(day)}</strong>
                <i aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <WeekNavButton direction="next" week={nextWeekStart} onNavigate={onNavigate} />
      </div>

      <div className="agenda">
        {days.map(day => {
          const meta = getDayMeta(day);
          return (
            <section
              className={["agenda-day", day === today ? "today" : "", meta.empty ? "empty" : ""].filter(Boolean).join(" ")}
              id={dayId(day)}
              aria-labelledby={`${dayId(day)}-title`}
              key={day}
            >
              <h3 className="agenda-day-title" id={`${dayId(day)}-title`}>
                {formatDayLabel(day)}
                {day === today ? <span className="today-label">Dnes</span> : null}
                {meta.empty ? <span className="agenda-day-note">{emptyDayText}</span> : null}
              </h3>
              {meta.empty ? null : <div className="agenda-day-items">{renderDay(day)}</div>}
            </section>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------------------------------- */
/* Skeleton with the same frame as the view */
/* ---------------------------------------- */

export function WeekViewSkeleton({ days, label }: { days: string[]; label: string }) {
  return (
    <section className="week-view week-agenda weekly-mobile" aria-label={label} aria-busy="true">
      <div className="week-strip">
        <span className="week-arrow" />
        <div className="week-strip-days">
          {days.map(day => (
            <span className="week-strip-day" key={day}>
              <span>{formatWeekday(day)}</span>
              <strong>{formatShortDate(day)}</strong>
              <i />
            </span>
          ))}
        </div>
        <span className="week-arrow" />
      </div>
      <div className="agenda">
        {days.slice(0, 3).map(day => (
          <section className="agenda-day" key={day}>
            <h3 className="agenda-day-title">{formatDayLabel(day)}</h3>
            <div className="agenda-day-items">
              <div className="skeleton-item">
                <span className="skeleton skeleton-poster" />
                <span className="skeleton-copy">
                  <span className="skeleton-line wide" />
                  <span className="skeleton-line short" />
                </span>
              </div>
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
