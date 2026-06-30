export const getPragueTodayISO = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
};

export const parseISODate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};

export const requireISODate = (value: string) => {
  const date = parseISODate(value);
  if (!date) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return date;
};

export const isMondayISODate = (value: string) => parseISODate(value)?.getUTCDay() === 1;

export const startOfISOWeek = (value: string) => {
  const date = requireISODate(value);
  const dayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayOffset);
  return date.toISOString().slice(0, 10);
};

export const addDaysISO = (value: string, days: number) => {
  const date = requireISODate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const isISOWeekStart = (value: string) => {
  try {
    return startOfISOWeek(value) === value;
  } catch {
    return false;
  }
};
