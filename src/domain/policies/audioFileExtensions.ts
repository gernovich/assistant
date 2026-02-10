/**
 * Политика: определение звуковых файлов по расширению.
 */
const AUDIO_EXTENSIONS = new Set(["ogg", "webm", "mp3", "wav", "m4a", "flac", "aac", "opus"]);

export function isAudioFile(extension: string): boolean {
  return AUDIO_EXTENSIONS.has(String(extension ?? "").toLowerCase());
}
