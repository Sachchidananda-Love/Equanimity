export const DISPLAY_TIME_ZONE = "America/Toronto";
export const MILLISECONDS_PER_DAY = 86400000;
export const displayDateParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function dateOnlyParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (date.getUTCFullYear() !== parts.year || date.getUTCMonth() + 1 !== parts.month || date.getUTCDate() !== parts.day) return null;
  return parts;
}

export function dateOnlyDay(value: string) {
  const parts = dateOnlyParts(value);
  return parts ? Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / MILLISECONDS_PER_DAY) : null;
}

export function dateOnlyTimestamp(value: string) {
  const parts = dateOnlyParts(value);
  return parts ? Date.UTC(parts.year, parts.month - 1, parts.day, 12) : Number.NaN;
}

export function displayDay(timestamp: number) {
  const parts = Object.fromEntries(displayDateParts.formatToParts(timestamp).map((part) => [part.type, part.value]));
  return Math.floor(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / MILLISECONDS_PER_DAY);
}


export function localCalendarDate(timestamp: number, timeZone = DISPLAY_TIME_ZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(timestamp).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
