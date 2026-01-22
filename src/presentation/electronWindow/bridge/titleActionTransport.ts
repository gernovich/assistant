import type { RecordingStartPayload, WindowAction } from "./windowBridgeContracts";

/**
 * Транспорт совместимости: кодирование actions в `document.title`.
 *
 * Мы НЕ меняем формат строк, чтобы не ломать существующее поведение.
 * Задача — централизовать строки и парсинг.
 */

export type ParsedTitleAction = { ok: true; action: WindowAction } | { ok: false; reason: string };

const PREFIX = "assistant-action:";

export function parseAssistantActionFromTitle(title: string): ParsedTitleAction {
  const t = String(title ?? "");
  if (!t.startsWith(PREFIX)) return { ok: false, reason: "not_an_assistant_action" };

  // В reminder окно сейчас шлёт: assistant-action:<verb>
  // В recording окно шлёт: assistant-action:<verb>[:payload]
  const raw = t.slice(PREFIX.length);
  if (!raw) return { ok: false, reason: "empty_action" };

  if (raw === "close") return { ok: true, action: { kind: "close" } };

  // reminder window
  if (raw === "start_recording") return { ok: true, action: { kind: "reminder.startRecording" } };
  if (raw === "create_protocol") return { ok: true, action: { kind: "reminder.createProtocol" } };
  if (raw === "cancelled") return { ok: true, action: { kind: "reminder.meetingCancelled" } };

  // recording window commands
  if (raw === "rec_stop") return { ok: true, action: { kind: "recording.stop" } };
  if (raw === "rec_pause") return { ok: true, action: { kind: "recording.pause" } };
  if (raw === "rec_resume") return { ok: true, action: { kind: "recording.resume" } };

  // payload commands (recording)
  if (raw.startsWith("rec_start:")) {
    const encoded = raw.slice("rec_start:".length);
    const payload = safeDecodeJson<RecordingStartPayload>(encoded);
    if (!payload) return { ok: false, reason: "invalid_rec_start_payload" };
    return { ok: true, action: { kind: "recording.start", payload } };
  }

  if (raw.startsWith("open_protocol:")) {
    const encoded = raw.slice("open_protocol:".length);
    const protocolFilePath = safeDecode(encoded);
    if (!protocolFilePath) return { ok: false, reason: "invalid_open_protocol_payload" };
    return { ok: true, action: { kind: "recording.openProtocol", protocolFilePath } };
  }

  return { ok: false, reason: `unknown_action:${raw}` };
}

export function formatAssistantActionTitle(action: WindowAction): string {
  // Используем текущие строки, чтобы было 1:1 с существующим UI.
  if (action.kind === "close") return `${PREFIX}close`;
  if (action.kind === "reminder.startRecording") return `${PREFIX}start_recording`;
  if (action.kind === "reminder.createProtocol") return `${PREFIX}create_protocol`;
  if (action.kind === "reminder.meetingCancelled") return `${PREFIX}cancelled`;
  if (action.kind === "recording.stop") return `${PREFIX}rec_stop`;
  if (action.kind === "recording.pause") return `${PREFIX}rec_pause`;
  if (action.kind === "recording.resume") return `${PREFIX}rec_resume`;
  if (action.kind === "recording.openProtocol") return `${PREFIX}open_protocol:${encodeURIComponent(action.protocolFilePath)}`;
  if (action.kind === "recording.start") return `${PREFIX}rec_start:${encodeURIComponent(JSON.stringify(action.payload))}`;
  // exhaustive
  const _never: never = action;
  return `${PREFIX}close`;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(String(s ?? ""));
  } catch {
    return "";
  }
}

function safeDecodeJson<T>(encoded: string): T | null {
  const decoded = safeDecode(encoded);
  if (!decoded) return null;
  try {
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}

