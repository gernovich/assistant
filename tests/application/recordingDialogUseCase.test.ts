import { describe, expect, it, vi } from "vitest";
import { RecordingDialogUseCase } from "../../src/application/recording/recordingDialogUseCase";
import { DEFAULT_SETTINGS } from "../../src/settingsStore";
import type { Event } from "../../src/types";

function makeEvent(): Event {
  return {
    calendar: { id: "cal", name: "Cal", type: "ics_url", config: { id: "cal", name: "Cal", type: "ics_url", enabled: true, url: "" } },
    id: "uid",
    summary: "Meet",
    start: new Date("2020-01-01T10:00:00.000Z"),
  } as any;
}

describe("RecordingDialogUseCase", () => {
  it("передаёт preferredEvent как locked defaultEventKey", () => {
    const warnLinuxNativeDepsOnOpen = vi.fn();
    const dlgOpen = vi.fn();
    const dialogFactory = vi.fn().mockImplementation((p) => {
      expect(p.lockDefaultEvent).toBe(true);
      expect(p.defaultEventKey).toBe("cal:uid");
      return { open: dlgOpen };
    });

    const uc = new RecordingDialogUseCase({
      getSettings: () => structuredClone(DEFAULT_SETTINGS),
      getEvents: () => [makeEvent()],
      getRecordingsProtocolsList: () => [],
      warnLinuxNativeDepsOnOpen,
      createProtocolFromEvent: async () => "p.md",
      createEmptyProtocolAndOpen: async () => "p2.md",
      openProtocolByPath: async () => undefined,
      dialogFactory,
      notice: vi.fn(),
      log: { info: vi.fn(), error: vi.fn() },
      now: () => new Date("2020-01-01T10:00:00.000Z"),
    });

    uc.open(makeEvent());
    expect(warnLinuxNativeDepsOnOpen).toHaveBeenCalledTimes(1);
    expect(dlgOpen).toHaveBeenCalledTimes(1);
  });

  it("если dlg.open бросает — показывает notice и пишет error", () => {
    const notice = vi.fn();
    const error = vi.fn();

    const uc = new RecordingDialogUseCase({
      getSettings: () => structuredClone(DEFAULT_SETTINGS),
      getEvents: () => [],
      getRecordingsProtocolsList: () => [],
      warnLinuxNativeDepsOnOpen: vi.fn(),
      createProtocolFromEvent: async () => "p.md",
      createEmptyProtocolAndOpen: async () => "p2.md",
      openProtocolByPath: async () => undefined,
      dialogFactory: () => ({
        open: () => {
          throw new Error("boom");
        },
      }),
      notice,
      log: { info: vi.fn(), error },
      now: () => new Date("2020-01-01T10:00:00.000Z"),
    });

    uc.open();
    expect(notice).toHaveBeenCalledWith("Ассистент: не удалось открыть диалог записи");
    expect(error).toHaveBeenCalledWith("Запись: не удалось открыть диалог", { code: "E_INTERNAL", error: "Error: boom" });
  });

  it("openResult: если dlg.open бросает — возвращает Result error и не бросает", () => {
    const uc = new RecordingDialogUseCase({
      getSettings: () => structuredClone(DEFAULT_SETTINGS),
      getEvents: () => [],
      getRecordingsProtocolsList: () => [],
      warnLinuxNativeDepsOnOpen: vi.fn(),
      createProtocolFromEvent: async () => "p.md",
      createEmptyProtocolAndOpen: async () => "p2.md",
      openProtocolByPath: async () => undefined,
      dialogFactory: () => ({
        open: () => {
          throw new Error("boom");
        },
      }),
      notice: vi.fn(),
      log: { info: vi.fn(), error: vi.fn() },
      now: () => new Date("2020-01-01T10:00:00.000Z"),
    });

    const r = uc.openResult();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("E_INTERNAL");
      expect(r.error.cause).toBe("Error: boom");
    }
  });

  it("не открывает окно повторно для того же preferredEvent в течение 30 секунд", () => {
    const dlgOpen = vi.fn();
    const dialogFactory = vi.fn().mockReturnValue({ open: dlgOpen });

    let now = new Date("2020-01-01T10:00:00.000Z");
    const uc = new RecordingDialogUseCase({
      getSettings: () => structuredClone(DEFAULT_SETTINGS),
      getEvents: () => [makeEvent()],
      getRecordingsProtocolsList: () => [],
      warnLinuxNativeDepsOnOpen: vi.fn(),
      createProtocolFromEvent: async () => "p.md",
      createEmptyProtocolAndOpen: async () => "p2.md",
      openProtocolByPath: async () => undefined,
      dialogFactory,
      notice: vi.fn(),
      log: { info: vi.fn(), error: vi.fn() },
      now: () => now,
    });

    const ev = makeEvent();
    uc.open(ev);
    uc.open(ev);
    expect(dlgOpen).toHaveBeenCalledTimes(1);

    now = new Date("2020-01-01T10:00:31.000Z");
    uc.open(ev);
    expect(dlgOpen).toHaveBeenCalledTimes(2);
  });
});

