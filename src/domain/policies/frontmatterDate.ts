/**
 * Политика: распарсить дату из frontmatter значения.
 *
 * Поддерживаем:
 * - Date (как есть)
 * - ISO string
 */
export function parseFrontmatterDate(raw: unknown): Date | undefined {
  if (raw instanceof Date) return raw;
  if (typeof raw === "string") {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return undefined;
}
