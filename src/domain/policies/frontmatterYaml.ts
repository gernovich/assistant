/**
 * Политика: генерация YAML-строк для frontmatter.
 *
 * Важно: pure-функции, escaping передаётся снаружи.
 */

export function yamlStringArrayLines(params: { key: string; values: string[]; escape: (s: string) => string }): string[] {
  const key = String(params.key ?? "").trim();
  const values = Array.isArray(params.values) ? params.values : [];
  if (!values.length) return [`${key}: []`];
  return [`${key}:`, ...values.map((v) => `  - ${params.escape(String(v ?? ""))}`)];
}
