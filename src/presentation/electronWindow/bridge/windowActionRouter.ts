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
    // ignore: recording window actions are not for reminder window
    case "recording.start":
    case "recording.stop":
    case "recording.pause":
    case "recording.resume":
    case "recording.openProtocol":
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
    // ignore: reminder window actions are not for recording window
    case "reminder.startRecording":
    case "reminder.createProtocol":
    case "reminder.meetingCancelled":
      return;
    default: {
      const _never: never = action;
      return _never;
    }
  }
}
