/**
 * Policy: работа с YAML frontmatter в md-файлах.
 *
 * Ограничения:
 * - рассчитано на “плоские” ключи `key: value`
 * - не парсит сложные структуры YAML
 */

type FrontmatterSplit = { frontmatter: string | null; body: string };

export function splitFrontmatter(md: string): FrontmatterSplit {
  const s = String(md ?? "");
  if (!s.startsWith("---\n")) return { frontmatter: null, body: s };
  const end = s.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: null, body: s };
  const fm = s.slice(4, end); // без начального "---\n"
  const body = s.slice(end + "\n---\n".length);
  return { frontmatter: fm, body };
}

export function parseFrontmatterMap(frontmatter: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = String(frontmatter ?? "").split("\n");
  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;
    if (l.startsWith("#")) continue;
    const idx = l.indexOf(":");
    if (idx <= 0) continue;
    const key = l.slice(0, idx).trim();
    const value = l.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

export function stringifyFrontmatterMap(map: Record<string, string>): string {
  const keys = Object.keys(map);
  keys.sort((a, b) => a.localeCompare(b));
  return keys.map((k) => `${k}: ${map[k]}`).join("\n");
}

export function upsertFrontmatter(md: string, updates: Record<string, string | null>): string {
  const { frontmatter, body } = splitFrontmatter(md);
  const cur = frontmatter ? parseFrontmatterMap(frontmatter) : {};

  for (const [k, v] of Object.entries(updates)) {
    if (v == null || v === "") {
      delete cur[k];
    } else {
      cur[k] = v;
    }
  }

  const nextFm = stringifyFrontmatterMap(cur);
  return ["---", nextFm, "---", body.startsWith("\n") ? body.slice(1) : body].join("\n");
}
