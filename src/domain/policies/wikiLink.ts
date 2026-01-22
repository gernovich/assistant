/**
 * Policy для wiki-link (Obsidian).
 *
 * Это pure-функции без зависимостей от Obsidian API.
 */

export function stripMarkdownExtension(path: string): string {
  return String(path ?? "").replace(/\.md$/i, "");
}

export function wikiLinkLine(params: { targetPath: string; label: string }): string {
  const target = stripMarkdownExtension(params.targetPath);
  const label = String(params.label ?? "");
  return `- [[${target}|${label}]]`;
}

