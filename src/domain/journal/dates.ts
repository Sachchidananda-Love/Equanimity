import type { JournalEntry } from "./types";
import { dateOnlyDay, dateOnlyTimestamp, displayDateParts, localCalendarDate, MILLISECONDS_PER_DAY } from "../dates/calendar";

/** Prefer a normalized entry date; otherwise preserve the existing loggedAt,
 * timestamp-ID and legacy display-date conventions in the app display timezone.
 * Unparseable dates must not silently acquire today's cycle context. */
export function journalEntryTimestamp(entry: JournalEntry, now: number): number | null {
  if (dateOnlyDay(entry.date) !== null) return dateOnlyTimestamp(entry.date);
  const recorded = entry.loggedAt ?? (typeof entry.id === "number" && entry.id >= 1e12 ? entry.id : null);
  if (recorded !== null) return Number.isFinite(recorded) && !Number.isNaN(new Date(recorded).getTime()) ? recorded : null;
  // "Today" is only a display label, not a durable historical date. New entries
  // have loggedAt; older labels without a timestamp cannot safely borrow now.
  if (entry.date.startsWith("Today")) return null;
  const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:,?\s+(\d{4}))?/.exec(entry.date);
  if (!match) return null;
  const referenceYear = Number(Object.fromEntries(displayDateParts.formatToParts(now).map(part => [part.type, part.value])).year);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(match[1]) + 1;
  let year = match[3] ? Number(match[3]) : referenceYear;
  const iso = () => `${year}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  if (!match[3] && dateOnlyTimestamp(iso()) > now + MILLISECONDS_PER_DAY) year--;
  return dateOnlyDay(iso()) === null ? null : dateOnlyTimestamp(iso());
}

export function journalEntryDate(entry: JournalEntry, now: number): string | null {
  const timestamp = journalEntryTimestamp(entry, now);
  return timestamp === null ? null : localCalendarDate(timestamp);
}
