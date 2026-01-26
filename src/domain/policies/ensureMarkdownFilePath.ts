/**
 * Политика: нормализовать wiki-link target (или путь) к markdown файлу.
 *
 * Пример:
 * - `Ассистент/Протоколы/A` -> `Ассистент/Протоколы/A.md`
 * - `Ассистент/Протоколы/A.md` -> без изменений
 */
export function ensureMarkdownFilePath(pathOrTarget: string): string {
  const s = String(pathOrTarget ?? "").trim();
  if (!s) return "";
  return s.endsWith(".md") ? s : `${s}.md`;
}
