/** Стабильный ключ события (используется для связи “календарь ↔ протокол/встреча”). */
export function makeEventKey(calendarId: string, eventId: string): string {
  return `${calendarId}:${eventId}`;
}

/** Нормализовать email для стабильных идентификаторов/поиска. */
function normalizeEmail(v: string): string {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  const m = s.match(/^mailto:(.+)$/i);
  return (m ? m[1] : s).trim().toLowerCase();
}

/**
 * Стабильный person_id для случаев, когда у нас есть email (например из календаря).
 *
 * Важно: это позволяет ссылаться на человека по `person_id` даже до создания его карточки.
 */
export function makePersonIdFromEmail(email: string): string {
  const norm = normalizeEmail(email);
  return `person-${shortStableId(norm, 10)}`;
}

/**
 * Детерминированный короткий id для стабильных имён файлов (но читаемых).
 *
 * Алгоритм: FNV-1a 32-bit → base36 (с pad).
 */
export function shortStableId(input: string, len = 6): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Приводим к unsigned.
  const u = h >>> 0;
  const s = u.toString(36);
  return s.padStart(len, "0").slice(0, len);
}
