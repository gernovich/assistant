/**
 * Policy: выбор mimeType для MediaRecorder.
 *
 * Чистая функция: `isSupported` передаётся извне.
 */
export function pickMediaRecorderMimeType(params: { isSupported: (mime: string) => boolean; prefs?: string[] }): string {
  const prefs = params.prefs ?? [
    "audio/ogg;codecs=opus",
    "audio/ogg",
    // webm/opus часто хуже дружит с длительностью/seek в некоторых плеерах Obsidian,
    // поэтому предпочитаем ogg, но оставляем webm как fallback.
    "audio/webm;codecs=opus",
    "audio/webm",
  ];
  for (const t of prefs) {
    try {
      if (params.isSupported(t)) return t;
    } catch {
      // ignore
    }
  }
  return "";
}
