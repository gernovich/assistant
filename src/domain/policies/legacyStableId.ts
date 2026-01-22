/**
 * Legacy поддержка старого формата имени файла встречи: `"... [sid].md"`.
 *
 * Исторически sid = `shortStableId(eventKey, 6)`; regex оставляем совместимым с текущим поведением.
 */

export function extractLegacyStableIdFromPath(path: string): string | null {
  const p = String(path ?? "");
  // Ожидаемый суффикс: " [abcdef].md" (длина sid сейчас 6)
  const m = p.match(/ \[([0-9a-fA-F]{6})\]\.md$/);
  return m ? String(m[1] ?? "").toLowerCase() : null;
}

export function legacyStableIdSuffix(sid: string): string {
  return ` [${String(sid ?? "").trim()}].md`;
}

