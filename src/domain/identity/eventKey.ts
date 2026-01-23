/**
 * EventKey — стабильная идентичность события: `${calendarId}:${eventId}`.
 *
 * Это value object (immutable) в виде branded string.
 */
export type EventKey = string & { readonly __brand: "EventKey" };

export function makeEventKey(calendarId: string, eventId: string): EventKey {
  // Важно: не бросаем исключения — ключ должен быть стабильной строкой.
  // Валидность проверяется отдельно (например в parseEventKey).
  const c = String(calendarId ?? "").trim();
  const e = String(eventId ?? "").trim();
  return `${c}:${e}` as EventKey;
}

export function parseEventKey(raw: string): EventKey | null {
  const s = String(raw ?? "").trim();
  const i = s.indexOf(":");
  if (i <= 0 || i === s.length - 1) return null;
  return s as EventKey;
}
