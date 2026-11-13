const PRAGUE = "Europe/Prague";
const DEFAULT_DURATION_MINUTES = 120;
export const CINEMA_LOCATION = "Kino Fidiko, Žamberk";

/** Offset of Europe/Prague from UTC (in minutes) at the given instant. */
const getPragueOffsetMinutes = (instant: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PRAGUE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  const asUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"));
  return Math.round((asUtc - instant.getTime()) / 60_000);
};

/** Convert a Prague wall-clock date + "HH:MM" to the real UTC instant (DST aware). */
export const pragueLocalToUtc = (dateISO: string, time: string) => {
  const [year, month, day] = dateISO.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes settle the offset even right around a DST switch.
  let offset = getPragueOffsetMinutes(new Date(wallClockAsUtc));
  offset = getPragueOffsetMinutes(new Date(wallClockAsUtc - offset * 60_000));
  return new Date(wallClockAsUtc - offset * 60_000);
};

const formatIcsDate = (date: Date) =>
  date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const escapeIcsText = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Fold lines to 75 octets as RFC 5545 requires (approximated by characters). */
const foldLine = (line: string) => {
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += 73) {
    chunks.push((index ? " " : "") + line.slice(index, index + 73));
  }
  return chunks.join("\r\n");
};

export type CalendarScreening = {
  id: string;
  title: string;
  dateISO: string;
  time: string | null;
  description?: string;
  formats?: string[];
  ticketUrl: string | null;
  fidikoUrl: string;
};

export const buildScreeningIcs = (screening: CalendarScreening, now = new Date()) => {
  if (!screening.time) return null;
  const start = pragueLocalToUtc(screening.dateISO, screening.time);
  const end = new Date(start.getTime() + DEFAULT_DURATION_MINUTES * 60_000);
  const url = screening.ticketUrl ?? screening.fidikoUrl;
  const details = [
    screening.formats?.length ? screening.formats.join(", ") : null,
    screening.description || null,
    screening.ticketUrl ? `Vstupenky: ${screening.ticketUrl}` : `Detail: ${screening.fidikoUrl}`,
  ].filter(Boolean).join("\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NZFD//Program kina//CS",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${screening.id}@nzfd`,
    `DTSTAMP:${formatIcsDate(now)}`,
    `DTSTART:${formatIcsDate(start)}`,
    `DTEND:${formatIcsDate(end)}`,
    `SUMMARY:${escapeIcsText(`Kino: ${screening.title}`)}`,
    `LOCATION:${escapeIcsText(CINEMA_LOCATION)}`,
    `DESCRIPTION:${escapeIcsText(details)}`,
    `URL:${url}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Promítání za hodinu",
    "TRIGGER:-PT1H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].map(foldLine).join("\r\n") + "\r\n";
};

export type CalendarPremiere = {
  id: string;
  title: string;
  dateISO: string;
  url: string | null;
  where: string;
};

/** All-day reminder for a premiere (Radar). */
export const buildPremiereIcs = (premiere: CalendarPremiere, now = new Date()) => {
  const day = premiere.dateISO.replace(/-/g, "");
  const next = new Date(`${premiere.dateISO}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NZFD//Radar premier//CS",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:radar-${premiere.id}@nzfd`,
    `DTSTAMP:${formatIcsDate(now)}`,
    `DTSTART;VALUE=DATE:${day}`,
    `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, "")}`,
    `SUMMARY:${escapeIcsText(`Premiéra: ${premiere.title}`)}`,
    `DESCRIPTION:${escapeIcsText(premiere.where)}`,
    ...(premiere.url ? [`URL:${premiere.url}`] : []),
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
    "END:VCALENDAR",
  ].map(foldLine).join("\r\n") + "\r\n";
};

const toFileName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "promitani";

export const downloadScreeningIcs = (screening: CalendarScreening) => {
  const ics = buildScreeningIcs(screening);
  if (!ics) return false;
  downloadIcs(ics, `${toFileName(screening.title)}-${screening.dateISO}.ics`);
  return true;
};

export const downloadPremiereIcs = (premiere: CalendarPremiere) => {
  downloadIcs(buildPremiereIcs(premiere), `premiera-${toFileName(premiere.title)}-${premiere.dateISO}.ics`);
  return true;
};

const downloadIcs = (ics: string, fileName: string) => {
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
};
