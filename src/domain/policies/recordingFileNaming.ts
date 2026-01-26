/**
 * Политика: именование файлов записи (prefix/timestamp/filename).
 */

export function recordingFilePrefixFromEventKey(eventKey?: string): string {
  const raw = String(eventKey ?? "").trim();
  if (!raw) return "manual";
  // Разрешаем: a-zA-Z0-9._:-, остальное заменяем на '_'
  return raw.replace(/[^a-zA-Z0-9._:-]+/g, "_") || "manual";
}

/** ISO string -> safe for filenames (заменяем ':' и '.' на '-') */
export function isoTimestampForFileName(iso: string): string {
  return String(iso ?? "").replace(/[:.]/g, "-");
}

export function recordingChunkFileName(params: { prefix: string; iso: string; ext: string }): string {
  const prefix = String(params.prefix ?? "").trim() || "manual";
  const ext = String(params.ext ?? "").trim() || "dat";
  const ts = isoTimestampForFileName(params.iso);
  return `${prefix}-${ts}.${ext}`;
}
