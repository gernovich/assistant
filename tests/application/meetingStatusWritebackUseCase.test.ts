import { describe, expect, it, vi } from "vitest";
import { MeetingStatusWritebackUseCase } from "../../src/application/calendar/meetingStatusWritebackUseCase";
import { DEFAULT_SETTINGS } from "../../src/settingsStore";

function meetingMd(params: { calendarId?: string; eventId?: string; start?: string; status?: string }): string {
  return `---
assistant_type: calendar_event
calendar_id: ${params.calendarId ?? "cal"}
event_id: ${params.eventId ?? "uid"}
start: ${params.start ?? "2020-01-01T10:00:00.000Z"}
status: ${params.status ?? "accepted"}
---

# Meeting
`;
}

describe("MeetingStatusWritebackUseCase", () => {
  it("успешно применяет статус и синхронизирует (manual, silent=false)", async () => {
    const notice = vi.fn();
    const setMyPartstat = vi.fn().mockResolvedValue(undefined);
    const syncFromCurrentEvents = vi.fn().mockResolvedValue(undefined);

    const uc = new MeetingStatusWritebackUseCase({
      getSettings: () => structuredClone(DEFAULT_SETTINGS),
      readMeetingFileText: async () => meetingMd({ status: "accepted" }),
      calendarService: {
        getEventByEventKey: () => null,
        setMyPartstat: setMyPartstat as any,
      },
      syncService: { syncFromCurrentEvents } as any,
      outbox: { enqueue: vi.fn() } as any,
      notice,
      log: { warn: vi.fn() },
      nowMs: () => 1000,
      randomHex: () => "abc",
    });

    await uc.applyFromMeetingFile({ path: "m.md" }, { silent: false });
    expect(setMyPartstat).toHaveBeenCalledTimes(1);
    expect(syncFromCurrentEvents).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalledWith("Ассистент: статус применён в календарь и синхронизирован");
  });

  it("дедуплицирует повторное применение в пределах 5 секунд", async () => {
    const setMyPartstat = vi.fn().mockResolvedValue(undefined);
    const syncFromCurrentEvents = vi.fn().mockResolvedValue(undefined);
    let now = 1000;

    const uc = new MeetingStatusWritebackUseCase({
      getSettings: () => structuredClone(DEFAULT_SETTINGS),
      readMeetingFileText: async () => meetingMd({ status: "accepted" }),
      calendarService: {
        getEventByEventKey: () => null,
        setMyPartstat: setMyPartstat as any,
      },
      syncService: { syncFromCurrentEvents } as any,
      outbox: { enqueue: vi.fn() } as any,
      notice: () => undefined,
      log: { warn: vi.fn() },
      nowMs: () => now,
      randomHex: () => "abc",
    });

    await uc.applyFromMeetingFile({ path: "m.md" }, { silent: true });
    now = 2000;
    await uc.applyFromMeetingFile({ path: "m.md" }, { silent: true });

    expect(setMyPartstat).toHaveBeenCalledTimes(1);
    expect(syncFromCurrentEvents).toHaveBeenCalledTimes(1);
  });

  it("при ошибке (silent=true) — только warn, без enqueue", async () => {
    const warn = vi.fn();
    const enqueue = vi.fn();

    const uc = new MeetingStatusWritebackUseCase({
      getSettings: () => structuredClone(DEFAULT_SETTINGS),
      readMeetingFileText: async () => meetingMd({ status: "accepted" }),
      calendarService: {
        getEventByEventKey: () => null,
        setMyPartstat: vi.fn().mockRejectedValue(new Error("net")),
      } as any,
      syncService: { syncFromCurrentEvents: vi.fn() } as any,
      outbox: { enqueue } as any,
      notice: () => undefined,
      log: { warn },
      nowMs: () => 1000,
      randomHex: () => "abc",
    });

    await uc.applyFromMeetingFile({ path: "m.md" }, { silent: true });
    expect(enqueue).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("при ошибке (silent=false) — кладёт действие в outbox", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const notice = vi.fn();

    const uc = new MeetingStatusWritebackUseCase({
      getSettings: () => structuredClone(DEFAULT_SETTINGS),
      readMeetingFileText: async () => meetingMd({ status: "accepted" }),
      calendarService: {
        getEventByEventKey: () => null,
        setMyPartstat: vi.fn().mockRejectedValue(new Error("net")),
      } as any,
      syncService: { syncFromCurrentEvents: vi.fn() } as any,
      outbox: { enqueue } as any,
      notice,
      log: { warn: vi.fn() },
      nowMs: () => 1000,
      randomHex: () => "abc",
    });

    await uc.applyFromMeetingFile({ path: "m.md" }, { silent: false });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalledWith("Ассистент: не удалось применить. Действие добавлено в офлайн-очередь.");
  });
});
