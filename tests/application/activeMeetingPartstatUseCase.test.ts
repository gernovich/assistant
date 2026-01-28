import { describe, expect, it, vi } from "vitest";
import { ActiveMeetingPartstatUseCase } from "../../src/application/calendar/activeMeetingPartstatUseCase";

function meetingMd(params: { calendarId?: string; eventId?: string; start?: string }): string {
  return `---
assistant_type: calendar_event
calendar_id: ${params.calendarId ?? "cal"}
event_id: ${params.eventId ?? "uid"}
start: ${params.start ?? "2020-01-01T10:00:00.000Z"}
---
`;
}

describe("ActiveMeetingPartstatUseCase", () => {
  it("если нет active file — notice", async () => {
    const notice = vi.fn();
    const uc = new ActiveMeetingPartstatUseCase({
      getActiveFile: () => null,
      readFileText: async () => "",
      getFrontmatterCache: () => undefined,
      setMyPartstatInCalendar: async () => undefined,
      enqueueOutbox: async () => undefined,
      notice,
      log: { warn: vi.fn(), error: vi.fn() },
      nowMs: () => 1,
      randomHex: () => "x",
    });

    await uc.apply("accepted");
    expect(notice).toHaveBeenCalledWith("Ассистент: откройте заметку встречи");
  });

  it("happy path — вызывает setMyPartstatInCalendar и показывает notice ok", async () => {
    const notice = vi.fn();
    const setMyPartstatInCalendar = vi.fn().mockResolvedValue(undefined);
    const uc = new ActiveMeetingPartstatUseCase({
      getActiveFile: () => ({ path: "m.md" }),
      readFileText: async () => meetingMd({}),
      getFrontmatterCache: () => undefined,
      setMyPartstatInCalendar,
      enqueueOutbox: async () => undefined,
      notice,
      log: { warn: vi.fn(), error: vi.fn() },
      nowMs: () => 1,
      randomHex: () => "x",
    });

    await uc.apply("declined");
    expect(setMyPartstatInCalendar).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalledWith("Ассистент: статус обновлён в календаре");
  });

  it("если setMyPartstatInCalendar падает — кладёт в outbox и показывает notice", async () => {
    const notice = vi.fn();
    const enqueueOutbox = vi.fn().mockResolvedValue(undefined);
    const warn = vi.fn();
    const uc = new ActiveMeetingPartstatUseCase({
      getActiveFile: () => ({ path: "m.md" }),
      readFileText: async () => meetingMd({}),
      getFrontmatterCache: () => ({ calendar_id: "cal", event_id: "uid", start: "2020-01-01T10:00:00.000Z" }),
      setMyPartstatInCalendar: vi.fn().mockRejectedValue(new Error("net")),
      enqueueOutbox,
      notice,
      log: { warn, error: vi.fn() },
      nowMs: () => 1000,
      randomHex: () => "abc",
    });

    await uc.apply("accepted");
    expect(enqueueOutbox).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalledWith("Ассистент: не удалось применить. Действие добавлено в офлайн-очередь.");
  });
});
