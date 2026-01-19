/** Стабильный ключ события (используется для связи “календарь ↔ протокол/встреча”). */
export function makeEventKey(calendarId: string, uid: string): string {
  return `${calendarId}:${uid}`;
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
