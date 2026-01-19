/**
 * Экранирование значения для YAML frontmatter.
 *
 * Мы храним значения как JSON-строку, чтобы безопасно переживать спецсимволы и переносы строк.
 */
export function yamlEscape(v: string): string {
  const s = (v ?? "").replace(/\r?\n/g, " ").trim();
  return JSON.stringify(s);
}
