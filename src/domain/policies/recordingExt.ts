/**
 * Политика: расширение файла записи по mimeType.
 */
export function recordingExtFromMimeType(mimeType: string): "ogg" | "webm" {
  const s = String(mimeType ?? "");
  return s.includes("ogg") ? "ogg" : "webm";
}
