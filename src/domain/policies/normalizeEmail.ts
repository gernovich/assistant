/**
 * Policy: нормализация email для стабильных идентификаторов/поиска.
 *
 * Примечание: поддерживает префикс `mailto:`.
 */
export function normalizeEmail(v: string): string {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  const m = s.match(/^mailto:(.+)$/i);
  return (m ? m[1] : s).trim().toLowerCase();
}

