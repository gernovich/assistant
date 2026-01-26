import type { RecordingBackendId } from "../../application/recording/recordingUseCase";

/**
 * Политика: нормализация backend id из настроек (включая legacy значения).
 */
export function recordingBackendFromSettings(raw: unknown): RecordingBackendId {
  const v = String(raw ?? "");
  if (v === "linux_native") return "linux_native";
  // legacy name (historical)
  if (v === "electron_desktop_capturer") return "electron_media_devices";
  // default
  return "electron_media_devices";
}
