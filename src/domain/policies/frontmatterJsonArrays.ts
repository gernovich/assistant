/**
 * Policy: парсинг JSON-массивов из значения frontmatter.
 *
 * Пример: files: ["a","b"] (как строка).
 */
export function parseJsonStringArray(raw: string): string[] {
  const s = String(raw ?? "").trim();
  if (!s.startsWith("[")) return [];
  try {
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x) => String(x));
  } catch {
    return [];
  }
}

