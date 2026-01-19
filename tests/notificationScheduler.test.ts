import { describe, expect, it, vi } from "vitest";
import { Notice } from "obsidian";
import { NotificationScheduler } from "../src/notifications/notificationScheduler";
import type { AssistantSettings, CalendarEvent } from "../src/types";

vi.mock("../src/os/linuxNotify", () => {
  return {
    linuxNotifySend: vi.fn(async () => {}),
    canUseLinuxNotifySend: vi.fn(() => true),
  };
});

vi.mock("../src/os/linuxPopup", () => {
  return {
    linuxPopupWindow: vi.fn(async () => "close"),
  };
});

describe("NotificationScheduler", () => {
  it("fires 'before' and 'atStart' notifications", () => {
    vi.useFakeTimers();
    const anyNotice = Notice as unknown as { messages: string[] };
    anyNotice.messages = [];

    const settings: AssistantSettings = {
      debug: { enabled: false },
      calendars: [],
      calendar: { autoRefreshEnabled: false, autoRefreshMinutes: 10, myEmail: "" },
      caldav: { accounts: [] },
      folders: {
        projects: "Ассистент/Проекты",
        people: "Ассистент/Люди",
        calendarEvents: "Ассистент/Встречи",
        protocols: "Ассистент/Протоколы",
        index: "Ассистент/Индекс",
      },
      notifications: {
        enabled: true,
        minutesBefore: 5,
        atStart: true,
        delivery: {
          method: "obsidian_notice",
          system: { urgency: "critical", timeoutMs: 20_000 },
          popup: { timeoutMs: 20_000 },
        },
      },
      agenda: { maxEvents: 50 },
      log: { maxEntries: 2048, retentionDays: 7 },
    };

    const logs: string[] = [];
    const sched = new NotificationScheduler(settings, (m) => logs.push(m));

    const base = new Date("2026-01-18T12:00:00.000Z");
    vi.setSystemTime(new Date("2026-01-18T11:50:00.000Z"));

    const ev: CalendarEvent = {
      calendarId: "cal1",
      uid: "u1",
      summary: "Meeting",
      start: base,
      end: new Date("2026-01-18T12:30:00.000Z"),
    };

    sched.schedule([ev]);

    // at 11:55Z -> "before"
    vi.advanceTimersByTime(5 * 60_000);
    expect(anyNotice.messages).toHaveLength(1);

    // at 12:00Z -> "start"
    vi.advanceTimersByTime(5 * 60_000);
    expect(anyNotice.messages).toHaveLength(2);

    expect(logs.length).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
  });

  it("system_notify_send: вызывает linuxNotifySend и логирует ошибку только один раз", async () => {
    const { linuxNotifySend } = await import("../src/os/linuxNotify");
    const spy = linuxNotifySend as unknown as ReturnType<typeof vi.fn>;
    spy.mockRejectedValueOnce(new Error("boom"));
    spy.mockRejectedValueOnce(new Error("boom2"));

    const settings: AssistantSettings = {
      debug: { enabled: false },
      calendars: [],
      calendar: { autoRefreshEnabled: false, autoRefreshMinutes: 10, myEmail: "" },
      caldav: { accounts: [] },
      folders: {
        projects: "Ассистент/Проекты",
        people: "Ассистент/Люди",
        calendarEvents: "Ассистент/Встречи",
        protocols: "Ассистент/Протоколы",
        index: "Ассистент/Индекс",
      },
      notifications: {
        enabled: true,
        minutesBefore: 0,
        atStart: false,
        delivery: {
          method: "system_notify_send",
          system: { urgency: "critical", timeoutMs: 20_000 },
          popup: { timeoutMs: 20_000 },
        },
      },
      agenda: { maxEvents: 50 },
      log: { maxEntries: 200, retentionDays: 7 },
    };

    const logs: string[] = [];
    const sched = new NotificationScheduler(settings, (m) => logs.push(m));

    const ev: CalendarEvent = {
      calendarId: "cal1",
      uid: "u1",
      summary: "Meeting",
      start: new Date("2026-01-18T12:00:00.000Z"),
      end: new Date("2026-01-18T12:30:00.000Z"),
    };

    // два вызова debug — два раза попытка linuxNotifySend, но сообщение об ошибке должно добавиться 1 раз
    await (sched as any).showGlobal(ev, "m1");
    await (sched as any).showGlobal(ev, "m2");

    expect(spy).toHaveBeenCalledTimes(2);
    expect(logs.filter((x) => x.includes("notify-send: ошибка")).length).toBe(1);
  });

  it("popup_window: вызывает action callbacks в зависимости от выбранной кнопки", async () => {
    const { linuxPopupWindow } = await import("../src/os/linuxPopup");
    const popup = linuxPopupWindow as unknown as ReturnType<typeof vi.fn>;

    const settings: AssistantSettings = {
      debug: { enabled: false },
      calendars: [],
      calendar: { autoRefreshEnabled: false, autoRefreshMinutes: 10, myEmail: "" },
      caldav: { accounts: [] },
      folders: {
        projects: "Ассистент/Проекты",
        people: "Ассистент/Люди",
        calendarEvents: "Ассистент/Встречи",
        protocols: "Ассистент/Протоколы",
        index: "Ассистент/Индекс",
      },
      notifications: {
        enabled: true,
        minutesBefore: 0,
        atStart: false,
        delivery: {
          method: "popup_window",
          system: { urgency: "critical", timeoutMs: 20_000 },
          popup: { timeoutMs: 20_000 },
        },
      },
      agenda: { maxEvents: 50 },
      log: { maxEntries: 200, retentionDays: 7 },
    };

    const createProtocol = vi.fn();
    const startRecording = vi.fn();
    const meetingCancelled = vi.fn();
    const sched = new NotificationScheduler(settings, undefined, { createProtocol, startRecording, meetingCancelled });

    const ev: CalendarEvent = {
      calendarId: "cal1",
      uid: "u1",
      summary: "Meeting",
      start: new Date("2026-01-18T12:00:00.000Z"),
    };

    popup.mockResolvedValueOnce("create_protocol");
    await (sched as any).showGlobal(ev, "m");
    expect(createProtocol).toHaveBeenCalledTimes(1);

    popup.mockResolvedValueOnce("start_recording");
    await (sched as any).showGlobal(ev, "m");
    expect(startRecording).toHaveBeenCalledTimes(1);

    popup.mockResolvedValueOnce("cancelled");
    await (sched as any).showGlobal(ev, "m");
    expect(meetingCancelled).toHaveBeenCalledTimes(1);
  });

  it("schedule не планирует события вне горизонта 48 часов", () => {
    vi.useFakeTimers();
    const anyNotice = Notice as unknown as { messages: string[] };
    anyNotice.messages = [];

    const settings: AssistantSettings = {
      debug: { enabled: false },
      calendars: [],
      calendar: { autoRefreshEnabled: false, autoRefreshMinutes: 10, myEmail: "" },
      caldav: { accounts: [] },
      folders: {
        projects: "Ассистент/Проекты",
        people: "Ассистент/Люди",
        calendarEvents: "Ассистент/Встречи",
        protocols: "Ассистент/Протоколы",
        index: "Ассистент/Индекс",
      },
      notifications: {
        enabled: true,
        minutesBefore: 0,
        atStart: true,
        delivery: {
          method: "obsidian_notice",
          system: { urgency: "critical", timeoutMs: 20_000 },
          popup: { timeoutMs: 20_000 },
        },
      },
      agenda: { maxEvents: 50 },
      log: { maxEntries: 200, retentionDays: 7 },
    };

    const sched = new NotificationScheduler(settings);
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const evTooFar: CalendarEvent = { calendarId: "c", uid: "u", summary: "Far", start: new Date("2026-01-03T01:00:00.000Z") }; // > 48ч
    sched.schedule([evTooFar]);

    vi.advanceTimersByTime(3 * 24 * 60 * 60_000);
    expect(anyNotice.messages).toHaveLength(0);
    vi.useRealTimers();
  });

  it("fallback: если delivery отсутствует, использует старый флаг notifications.global.enabled", async () => {
    const { linuxNotifySend } = await import("../src/os/linuxNotify");
    const spy = linuxNotifySend as unknown as ReturnType<typeof vi.fn>;
    spy.mockResolvedValueOnce(undefined);

    const settings: AssistantSettings = {
      debug: { enabled: false },
      calendars: [],
      calendar: { autoRefreshEnabled: false, autoRefreshMinutes: 10, myEmail: "" },
      caldav: { accounts: [] },
      folders: {
        projects: "Ассистент/Проекты",
        people: "Ассистент/Люди",
        calendarEvents: "Ассистент/Встречи",
        protocols: "Ассистент/Протоколы",
        index: "Ассистент/Индекс",
      },
      notifications: {
        enabled: true,
        minutesBefore: 0,
        atStart: false,
        delivery: undefined as any,
        // старый формат
        global: { enabled: true },
      } as any,
      agenda: { maxEvents: 50 },
      log: { maxEntries: 200, retentionDays: 7 },
    };

    const sched = new NotificationScheduler(settings);
    const ev: CalendarEvent = { calendarId: "c", uid: "u", summary: "M", start: new Date("2026-01-01T00:00:00.000Z") };
    await (sched as any).showGlobal(ev, "m");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("popup_window: логирует ошибку при падении linuxPopupWindow", async () => {
    const { linuxPopupWindow } = await import("../src/os/linuxPopup");
    const popup = linuxPopupWindow as unknown as ReturnType<typeof vi.fn>;
    popup.mockRejectedValueOnce(new Error("boom"));

    const settings: AssistantSettings = {
      debug: { enabled: false },
      calendars: [],
      calendar: { autoRefreshEnabled: false, autoRefreshMinutes: 10, myEmail: "" },
      caldav: { accounts: [] },
      folders: {
        projects: "Ассистент/Проекты",
        people: "Ассистент/Люди",
        calendarEvents: "Ассистент/Встречи",
        protocols: "Ассистент/Протоколы",
        index: "Ассистент/Индекс",
      },
      notifications: {
        enabled: true,
        minutesBefore: 0,
        atStart: false,
        delivery: {
          method: "popup_window",
          system: { urgency: "critical", timeoutMs: 20_000 },
          popup: { timeoutMs: 20_000 },
        },
      },
      agenda: { maxEvents: 50 },
      log: { maxEntries: 200, retentionDays: 7 },
    };

    const logs: string[] = [];
    const sched = new NotificationScheduler(settings, (m) => logs.push(m));
    const ev: CalendarEvent = { calendarId: "c", uid: "u", summary: "M", start: new Date("2026-01-01T00:00:00.000Z") };
    await (sched as any).showGlobal(ev, "m");
    expect(logs.some((x) => x.includes("popup_window: ошибка"))).toBe(true);
  });
});
