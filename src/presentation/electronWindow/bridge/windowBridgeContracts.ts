/**
 * Контракты взаимодействия между окнами Electron (BrowserWindow) и кодом плагина.
 *
 * Важно: этот файл фиксирует типизированный контракт и не зависит от транспорта.
 * Транспорт: Electron IPC (рендер↔рендер) через `ipcRenderer.sendTo`.
 */

export type IpcChannel =
  | "assistant/window/ready"
  | "assistant/window/action"
  | "assistant/window/request"
  | "assistant/window/response"
  | "assistant/recording/stats"
  | "assistant/recording/viz"
  | "assistant/test/message";

export type IpcEnvelope<TChannel extends IpcChannel, TPayload> = {
  id: string;
  channel: TChannel;
  ts: number;
  payload: TPayload;
};

// Действия (окно -> приложение)
export type WindowAction =
  | { kind: "close" }
  // окно напоминания
  | { kind: "reminder.startRecording" }
  | { kind: "reminder.createProtocol" }
  | { kind: "reminder.meetingCancelled" }
  // окно записи
  | { kind: "recording.start"; payload: RecordingStartPayload }
  | { kind: "recording.stop" }
  | { kind: "recording.pause" }
  | { kind: "recording.resume" }
  | { kind: "recording.openProtocol"; protocolFilePath: string }
  // тестовый диалог
  | { kind: "test.dialogOne" }
  | { kind: "test.dialogTwo" }
  | { kind: "test.dialogThree" };

export type RecordingStartPayload = {
  mode: "manual_new" | "occurrence_new" | "meeting_new" | "continue_protocol";
  occurrenceKey?: string;
  eventSummary?: string;
  protocolFilePath?: string;
};

export type WindowActionEvent = IpcEnvelope<"assistant/window/action", WindowAction>;

// Запрос/ответ (окно -> приложение -> окно)
export type WindowRequest = {
  id: string;
  ts: number;
  action: WindowAction;
};

export type WindowResponse = { id: string; ok: true } | { id: string; ok: false; error: { code: string; message: string; cause?: string } };

export type WindowRequestEvent = IpcEnvelope<"assistant/window/request", WindowRequest>;
export type WindowResponseEvent = IpcEnvelope<"assistant/window/response", WindowResponse>;

// Пуш (приложение -> окно)
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

// Конверт транспорта (не зависит от реализации)
export type WindowTransportMessage =
  | { type: "window/request"; payload: WindowRequest }
  | { type: "window/response"; payload: WindowResponse }
  | { type: "recording/stats"; payload: RecordingStatsDto }
  | { type: "recording/viz"; payload: RecordingVizDto }
  | { type: "recording/viz-clear"; payload: {} }
  | { type: "test/message"; payload: { message: string; ts: number } };
