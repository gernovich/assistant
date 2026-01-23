/**
 * Контракты взаимодействия между окнами Electron (BrowserWindow) и кодом плагина.
 *
 * Важно: этот файл фиксирует типизированный контракт и не зависит от транспорта.
 * Транспорт: Electron IPC (renderer<->renderer) через `ipcRenderer.sendTo`.
 */

export type IpcChannel =
  | "assistant/window/ready"
  | "assistant/window/action"
  | "assistant/window/request"
  | "assistant/window/response"
  | "assistant/recording/stats"
  | "assistant/recording/viz";

export type IpcEnvelope<TChannel extends IpcChannel, TPayload> = {
  id: string;
  channel: TChannel;
  ts: number;
  payload: TPayload;
};

// Actions (окно -> приложение)
export type WindowAction =
  | { kind: "close" }
  // reminder window
  | { kind: "reminder.startRecording" }
  | { kind: "reminder.createProtocol" }
  | { kind: "reminder.meetingCancelled" }
  // recording window
  | { kind: "recording.start"; payload: RecordingStartPayload }
  | { kind: "recording.stop" }
  | { kind: "recording.pause" }
  | { kind: "recording.resume" }
  | { kind: "recording.openProtocol"; protocolFilePath: string };

export type RecordingStartPayload = {
  mode: "manual_new" | "occurrence_new" | "meeting_new" | "continue_protocol";
  occurrenceKey?: string;
  eventSummary?: string;
  protocolFilePath?: string;
};

export type WindowActionEvent = IpcEnvelope<"assistant/window/action", WindowAction>;

// Request/response (окно -> приложение -> окно)
export type WindowRequest = {
  id: string;
  ts: number;
  action: WindowAction;
};

export type WindowResponse =
  | { id: string; ok: true }
  | { id: string; ok: false; error: { code: string; message: string; cause?: string } };

export type WindowRequestEvent = IpcEnvelope<"assistant/window/request", WindowRequest>;
export type WindowResponseEvent = IpcEnvelope<"assistant/window/response", WindowResponse>;

// Push (приложение -> окно)
export type RecordingStatsDto = {
  status: "idle" | "recording" | "paused";
  startedAtMs?: number;
  elapsedMs?: number;
  filesTotal: number;
  filesRecognized: number;
  foundProjects?: number;
  foundFacts?: number;
  foundPeople?: number;
  nextChunkInMs?: number;
  eventKey?: string;
  protocolFilePath?: string;
};

export type RecordingVizDto = { amp01: number };

