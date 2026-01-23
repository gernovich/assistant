/**
 * Policy: очистить имя файла от запрещённых символов и лишних пробелов.
 */
export function sanitizeFileName(name: string): string {
  // Удаляем символы, запрещённые в популярных файловых системах и путях Obsidian:
  // / \ : * ? " < > |, а также управляющие символы.
  const cleaned = (name ?? "")
    .replace(/[\/\\:\*\?"<>\|]/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Без названия";
}
