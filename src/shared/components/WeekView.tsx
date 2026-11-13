import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatDayLabel, formatWeekRange, formatWeekday } from "../lib/view-helpers";

export type DayMeta = { empty: boolean; hasSubtitles?: boolean };
type Direction = "previous" | "next";

/** Everything needed to draw one week. */
export type WeekContent = {
  days: string[];
  getDayMeta: (day: string) => DayMeta;
  renderDay: (day: string) => ReactNode;
};

type Props = {
  idPrefix: string;
  title: string;
  today: string;
  selectedDay: string | null;
  /** Land on the selected day when the view first opens (app start); otherwise it opens at the top. */
  landOnSelectedDay?: boolean;
  current: WeekContent;
  /** Neighbour weeks shown while swiping; `null` = the week exists but is not loaded yet. */
  previous: WeekContent | null;
  next: WeekContent | null;
  previousWeekStart: string | null;
  nextWeekStart: string | null;
  onNavigate: (week: string) => void;
  onDayChange?: (day: string) => void;
  emptyDayText: string;
};

const SWIPE_COMMIT_RATIO = 0.25;
const SWIPE_COMMIT_VELOCITY = 0.3; // px per ms: a short flick is enough
const TURN_MS = 260;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/**
 * A week change in flight. Module-level so it survives the remount that
 * happens when the next week first shows a loading skeleton.
 */
let pendingSwap: { alignToStrip: boolean; scrollY: number } | null = null;

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The week as a horizontal "page": the neighbouring weeks sit left and right
 * with their real content, follow the finger, and the page turns on release.
 */
export function WeekView({
  idPrefix,
  title,
  today,
  selectedDay,
  landOnSelectedDay = true,
  current,
  previous,
  next,
  previousWeekStart,
  nextWeekStart,
  onNavigate,
  onDayChange,
  emptyDayText,
}: Props) {
  const { days } = current;
  const rootRef = useRef<HTMLElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrolledWeek = useRef<string | null>(null);
  const spyLockedUntil = useRef(0);
  const animating = useRef(false);
  const weekKey = days[0] ?? "";
  const [activeDay, setActiveDay] = useState<string | null>(selectedDay);
  const dayId = (day: string) => `${idPrefix}-day-${day}`;

  // Latest values for the native touch listeners.
  const nav = useRef({ previousWeekStart, nextWeekStart, onNavigate });
  nav.current = { previousWeekStart, nextWeekStart, onNavigate };

  /** How far the list is scrolled under the sticky strip; neighbours start at the same visible line. */
  const getPeekOffset = () => {
    const viewport = viewportRef.current;
    const strip = stripRef.current;
    if (!viewport || !strip) return 0;
    return Math.max(0, strip.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top);
  };

  /** Scroll the page so a day starts right under the pinned strip (measured, the strip height varies). */
  const scrollToDay = (day: string, behavior: ScrollBehavior) => {
    const section = document.getElementById(dayId(day));
    const strip = stripRef.current;
    if (!section || !strip) return;
    const top = section.getBoundingClientRect().top + window.scrollY - strip.offsetHeight;
    window.scrollTo({ top: Math.max(0, top), behavior });
  };

  const setTrack = (offsetPx: number, ms = 0) => {
    const track = trackRef.current;
    if (!track) return;
    track.style.transition = ms ? `transform ${ms}ms ${EASE}` : "none";
    track.style.transform = offsetPx ? `translateX(${offsetPx}px)` : "";
  };

  const turnTo = (direction: Direction) => {
    const target = direction === "next" ? nav.current.nextWeekStart : nav.current.previousWeekStart;
    const track = trackRef.current;
    if (!target || !track || animating.current) return false;
    animating.current = true;
    const peek = getPeekOffset();
    track.style.setProperty("--peek-offset", `${peek}px`);
    const width = track.clientWidth;
    const finish = () => {
      pendingSwap = { alignToStrip: peek > 0, scrollY: window.scrollY };
      nav.current.onNavigate(target);
      window.setTimeout(() => {
        animating.current = false;
      }, 1000);
    };
    if (prefersReducedMotion()) {
      finish();
      return true;
    }
    setTrack(direction === "next" ? -width : width, TURN_MS);
    window.setTimeout(finish, TURN_MS);
    return true;
  };

  // The neighbour became the current week: drop the offset without a visible jump.
  useLayoutEffect(() => {
    const swap = pendingSwap;
    if (!swap) return;
    pendingSwap = null;
    scrolledWeek.current = weekKey; // a week change never jumps to a particular day
    setActiveDay(days[0] ?? null);
    setTrack(0);
    trackRef.current?.style.removeProperty("--peek-offset");
    const viewport = viewportRef.current;
    const strip = stripRef.current;
    if (!viewport || !strip) return;
    viewport.style.removeProperty("--week-min-height");
    // Where the page has to be scrolled so nothing moves on screen. Scrolled into the week, the
    // neighbour was shown starting right under the pinned strip, so the new week starts there;
    // otherwise the page stays where it was. Done in this frame (before paint): no visible scroll.
    const target = swap.alignToStrip
      ? viewport.getBoundingClientRect().top + window.scrollY - strip.offsetHeight
      : swap.scrollY;
    // A short week gets just enough height for that scroll position to exist. It is released
    // again once the page is back at the top (see the scroll handler).
    const missing = target - (document.documentElement.scrollHeight - window.innerHeight);
    if (missing > 0) {
      viewport.style.setProperty("--week-min-height", `${Math.ceil(viewport.offsetHeight + missing)}px`);
    }
    if (Math.abs(window.scrollY - target) > 1) window.scrollTo({ top: target, behavior: "instant" });
    animating.current = false;
  }, [weekKey]);

  // First open: land on the selected day (today, or the first day with a program).
  useEffect(() => {
    if (!selectedDay || !days.includes(selectedDay) || scrolledWeek.current === weekKey) return;
    scrolledWeek.current = weekKey;
    if (!landOnSelectedDay || selectedDay === days[0]) return;
    setActiveDay(selectedDay);
    const frame = window.requestAnimationFrame(() => {
      spyLockedUntil.current = Date.now() + 400;
      scrollToDay(selectedDay, "instant");
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
      let currentDay = days[0];
      for (const day of days) {
        const section = document.getElementById(dayId(day));
        if (section && section.getBoundingClientRect().top <= stripBottom + 4) currentDay = day;
      }
      setActiveDay(previousDay => (previousDay === currentDay ? previousDay : currentDay));
    };
    const onScroll = () => {
      // Back at the top: drop the height a week change reserved, so a short week ends where it ends.
      if (window.scrollY <= 0) viewportRef.current?.style.removeProperty("--week-min-height");
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
    // Re-subscribed per week; `days` is fully determined by `weekKey`.
  }, [weekKey]);

  // Drag the week sideways. Native listeners so a horizontal drag can block vertical scrolling.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let start: { x: number; y: number; time: number } | null = null;
    let axis: "x" | "y" | null = null;
    let offset = 0;

    const onStart = (event: TouchEvent) => {
      if (animating.current || event.touches.length !== 1) {
        start = null;
        return;
      }
      const touch = event.touches[0];
      start = { x: touch.clientX, y: touch.clientY, time: event.timeStamp };
      axis = null;
      offset = 0;
    };

    const onMove = (event: TouchEvent) => {
      if (!start) return;
      const touch = event.touches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (!axis) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
        if (axis === "x") track.style.setProperty("--peek-offset", `${getPeekOffset()}px`);
      }
      if (axis !== "x") return;
      event.preventDefault();
      const target = dx < 0 ? nav.current.nextWeekStart : nav.current.previousWeekStart;
      offset = target ? dx : dx * 0.2; // rubber band when there is no week to go to
      setTrack(offset);
    };

    const onEnd = (event: TouchEvent) => {
      if (!start || axis !== "x") {
        start = null;
        return;
      }
      const width = track.clientWidth;
      const velocity = Math.abs(offset) / Math.max(1, event.timeStamp - start.time);
      const direction: Direction = offset < 0 ? "next" : "previous";
      start = null;
      const committed =
        (Math.abs(offset) > width * SWIPE_COMMIT_RATIO || (velocity > SWIPE_COMMIT_VELOCITY && Math.abs(offset) > 24)) &&
        turnTo(direction);
      if (!committed) setTrack(0, 200);
    };

    track.addEventListener("touchstart", onStart, { passive: true });
    track.addEventListener("touchmove", onMove, { passive: false });
    track.addEventListener("touchend", onEnd);
    track.addEventListener("touchcancel", onEnd);
    return () => {
      track.removeEventListener("touchstart", onStart);
      track.removeEventListener("touchmove", onMove);
      track.removeEventListener("touchend", onEnd);
      track.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const jumpToDay = (day: string) => {
    setActiveDay(day);
    onDayChange?.(day);
    spyLockedUntil.current = Date.now() + 900;
    scrollToDay(day, prefersReducedMotion() ? "instant" : "smooth");
  };

  return (
    <section
      className="week-view"
      ref={rootRef}
      aria-label={`${title}: ${formatWeekRange(days[0] ?? null, days[6] ?? null)}`}
    >
      <div className="week-strip" ref={stripRef}>
        <WeekNavButton direction="previous" disabled={!previousWeekStart} onClick={() => turnTo("previous")} />
        <div className="week-strip-days" role="group" aria-label="Dny v týdnu">
          {days.map(day => {
            const meta = current.getDayMeta(day);
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
                <strong>{Number(day.slice(8))}</strong>
                <i aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <WeekNavButton direction="next" disabled={!nextWeekStart} onClick={() => turnTo("next")} />
      </div>

      <div className="agenda-viewport" ref={viewportRef}>
        <div className="agenda-track" ref={trackRef}>
          {/* Panes keyed by week start: the week swiped into view keeps its DOM (and loaded posters) when it becomes current. */}
          {[
            previousWeekStart ? { week: previousWeekStart, role: "previous" as const, content: previous } : null,
            { week: weekKey, role: "current" as const, content: current },
            nextWeekStart ? { week: nextWeekStart, role: "next" as const, content: next } : null,
          ]
            .filter(pane => pane !== null)
            .map(pane => {
              const isCurrent = pane.role === "current";
              return (
                <div
                  className={`agenda-pane ${pane.role}`}
                  aria-hidden={isCurrent ? undefined : true}
                  inert={!isCurrent}
                  key={pane.week}
                >
                  {pane.content ? (
                    <WeekList
                      content={pane.content}
                      today={today}
                      emptyDayText={emptyDayText}
                      idOf={isCurrent ? dayId : undefined}
                    />
                  ) : (
                    <WeekListSkeleton />
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </section>
  );
}

function WeekNavButton({ direction, disabled, onClick }: { direction: Direction; disabled: boolean; onClick: () => void }) {
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;
  const label = direction === "previous" ? "Předchozí týden" : "Další týden";
  return (
    <button className="week-arrow" type="button" disabled={disabled} onClick={onClick} aria-label={label} title={label}>
      <Icon size={22} aria-hidden="true" />
    </button>
  );
}

/** The days of one week stacked; only the current week carries ids (scroll targets). */
function WeekList({
  content,
  today,
  emptyDayText,
  idOf,
}: {
  content: WeekContent;
  today: string;
  emptyDayText: string;
  idOf?: (day: string) => string;
}) {
  return (
    <div className="agenda">
      {content.days.map(day => {
        const meta = content.getDayMeta(day);
        const id = idOf?.(day);
        return (
          <section
            className={["agenda-day", day === today ? "today" : "", meta.empty ? "empty" : ""].filter(Boolean).join(" ")}
            id={id}
            aria-labelledby={id ? `${id}-title` : undefined}
            key={day}
          >
            <h3 className="agenda-day-title" id={id ? `${id}-title` : undefined}>
              <span className="agenda-day-date">{formatDayLabel(day)}</span>
              {day === today ? <span className="today-label">Dnes</span> : null}
              {meta.empty ? <span className="agenda-day-note">{emptyDayText}</span> : null}
            </h3>
            {meta.empty ? null : <div className="agenda-day-items">{content.renderDay(day)}</div>}
          </section>
        );
      })}
    </div>
  );
}

function WeekListSkeleton({ days }: { days?: string[] }) {
  return (
    <div className="agenda" aria-busy="true">
      {(days ?? ["1", "2", "3"]).slice(0, 3).map(day => (
        <section className="agenda-day" key={day}>
          <h3 className="agenda-day-title">{days ? formatDayLabel(day) : <span className="skeleton-line short" />}</h3>
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
  );
}

/** Loading frame with the same strip as the real view. */
export function WeekViewSkeleton({ days, label }: { days: string[]; label: string }) {
  return (
    <section className="week-view" aria-label={label} aria-busy="true">
      <div className="week-strip">
        <span className="week-arrow" />
        <div className="week-strip-days">
          {days.map(day => (
            <span className="week-strip-day" key={day}>
              <span>{formatWeekday(day)}</span>
              <strong>{Number(day.slice(8))}</strong>
              <i />
            </span>
          ))}
        </div>
        <span className="week-arrow" />
      </div>
      <div className="agenda-viewport loading">
        <WeekListSkeleton days={days} />
      </div>
    </section>
  );
}
