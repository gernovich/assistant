import { describe, expect, it, vi } from "vitest";
import { handleRecordingWindowAction, handleReminderWindowAction } from "../../src/presentation/electronWindow/bridge/windowActionRouter";

describe("windowActionRouter", () => {
  it("reminder: маршрутизирует reminder actions и игнорирует recording actions", async () => {
    const h = {
      close: vi.fn(async () => undefined),
      startRecording: vi.fn(async () => undefined),
      createProtocol: vi.fn(async () => undefined),
      meetingCancelled: vi.fn(async () => undefined),
    };

    await handleReminderWindowAction({ kind: "reminder.startRecording" }, h);
    expect(h.startRecording).toHaveBeenCalledTimes(1);

    await handleReminderWindowAction({ kind: "recording.stop" }, h);
    expect(h.startRecording).toHaveBeenCalledTimes(1);
    expect(h.close).toHaveBeenCalledTimes(0);
  });

  it("recording: маршрутизирует recording actions и игнорирует reminder actions", async () => {
    const h = {
      close: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined),
      openProtocol: vi.fn(async () => undefined),
    };

    await handleRecordingWindowAction({ kind: "recording.openProtocol", protocolFilePath: "a.md" }, h);
    expect(h.openProtocol).toHaveBeenCalledWith("a.md");

    await handleRecordingWindowAction({ kind: "reminder.createProtocol" }, h);
    expect(h.start).toHaveBeenCalledTimes(0);
    expect(h.stop).toHaveBeenCalledTimes(0);
  });
});

