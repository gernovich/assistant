import type { RecordingStartPayload, WindowAction } from "./windowBridgeContracts";

export type ReminderWindowActionHandlers = {
  close: () => void | Promise<void>;
  startRecording: () => void | Promise<void>;
  createProtocol: () => void | Promise<void>;
  meetingCancelled: () => void | Promise<void>;
};

export function handleReminderWindowAction(action: WindowAction, h: ReminderWindowActionHandlers): void | Promise<void> {
  switch (action.kind) {
    case "close":
      return h.close();
    case "reminder.startRecording":
      return h.startRecording();
    case "reminder.createProtocol":
      return h.createProtocol();
    case "reminder.meetingCancelled":
      return h.meetingCancelled();
    // Игнорируем: действия окна записи не относятся к напоминанию
    case "recording.start":
    case "recording.stop":
    case "recording.pause":
    case "recording.resume":
    case "recording.openProtocol":
      return;
    // Игнорируем: действия тестового диалога не относятся к напоминанию
    case "test.dialogOne":
    case "test.dialogTwo":
    case "test.dialogThree":
      return;
    default: {
      const _never: never = action;
      return _never;
    }
  }
}

export type RecordingWindowActionHandlers = {
  close: () => void | Promise<void>;
  start: (payload: RecordingStartPayload) => void | Promise<void>;
  stop: () => void | Promise<void>;
  pause: () => void | Promise<void>;
  resume: () => void | Promise<void>;
  openProtocol: (protocolFilePath: string) => void | Promise<void>;
};

export function handleRecordingWindowAction(action: WindowAction, h: RecordingWindowActionHandlers): void | Promise<void> {
  switch (action.kind) {
    case "close":
      return h.close();
    case "recording.start":
      return h.start(action.payload);
    case "recording.stop":
      return h.stop();
    case "recording.pause":
      return h.pause();
    case "recording.resume":
      return h.resume();
    case "recording.openProtocol":
      return h.openProtocol(String(action.protocolFilePath ?? ""));
    // Игнорируем: действия окна напоминания не относятся к записи
    case "reminder.startRecording":
    case "reminder.createProtocol":
    case "reminder.meetingCancelled":
      return;
    // Игнорируем: действия тестового диалога не относятся к записи
    case "test.dialogOne":
    case "test.dialogTwo":
    case "test.dialogThree":
      return;
    default: {
      const _never: never = action;
      return _never;
    }
  }
}

export type TestDialogActionHandlers = {
  onMessage: (action: WindowAction) => void | Promise<void>;
};

export function handleTestDialogAction(action: WindowAction, h: TestDialogActionHandlers): void | Promise<void> {
  switch (action.kind) {
    case "test.dialogOne":
    case "test.dialogTwo":
    case "test.dialogThree":
      return h.onMessage(action);
    // Игнорируем: остальные действия не относятся к тестовому диалогу
    case "close":
    case "reminder.startRecording":
    case "reminder.createProtocol":
    case "reminder.meetingCancelled":
    case "recording.start":
    case "recording.stop":
    case "recording.pause":
    case "recording.resume":
    case "recording.openProtocol":
      return;
    default: {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _exhaustive: never = action;
      return;
    }
  }
}
