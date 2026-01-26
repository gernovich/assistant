/**
 * OccurrenceKey — стабильная идентичность экземпляра: `${calendarId}:${eventId}:${startMs}`.
 */
export type OccurrenceKey = string & { readonly __brand: "OccurrenceKey" };

export function makeOccurrenceKey(calendarId: string, eventId: string, start: Date): OccurrenceKey {
  const c = String(calendarId ?? "").trim();
  const e = String(eventId ?? "").trim();
  const ms = start instanceof Date ? start.getTime() : Number(start);
  const safeMs = Number.isFinite(ms) ? Math.floor(ms) : 0;
  return `${c}:${e}:${safeMs}` as OccurrenceKey;
}
