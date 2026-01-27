import type { RecordingBackendId } from "../../application/recording/recordingUseCase";

/**
 * Политика: нормализация backend id из настроек (включая legacy значения).
 */
export function recordingBackendFromSettings(raw: unknown): RecordingBackendId {
  const v = String(raw ?? "");
  if (v === "g_streamer") return "g_streamer";
  // legacy name (historical)
  if (v === "electron_desktop_capturer") return "electron_media_devices";
  // default
  return "electron_media_devices";
}
