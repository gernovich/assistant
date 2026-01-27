import { describe, expect, it, vi } from "vitest";
import { Notice } from "obsidian";
import { NotificationScheduler } from "../src/notifications/notificationScheduler";
import * as electronWindowReminder from "../src/notifications/electronWindowReminder";
import type { AssistantSettings, Calendar, Event } from "../src/types";

function cal(id: string): Calendar {
  return { id, name: id, type: "ics_url", config: { id, name: id, type: "ics_url", enabled: true } };
}

describe("NotificationScheduler", () => {
  it("fires 'before' and 'atStart' notifications", () => {
    vi.useFakeTimers();
    const anyNotice = Notice as unknown as { messages: string[] };
    anyNotice.messages = [];

    const settings: AssistantSettings = {
      debug: { enabled: false },
      calendars: [],
      calendar: { autoRefreshEnabled: false, autoRefreshMinutes: 10, myEmail: "", persistentCacheMaxEventsPerCalendar: 2000 },
      caldav: { accounts: [] },
      folders: {
        projects: "Ассистент/Проекты",
        people: "Ассистент/Люди",
        calendarEvents: "Ассистент/Встречи",
        protocols: "Ассистент/Протоколы",
      },
      notifications: {
        enabled: true,
        minutesBefore: 5,
        atStart: true,
      },
      recording: {
        chunkMinutes: 5,
        audioBackend: "electron_media_devices",
        gstreamerMicProcessing: "none",
        gstreamerMonitorProcessing: "none",
        autoStartEnabled: false,
        autoStartSeconds: 5,
      },
      agenda: { maxEvents: 50 },
      log: { maxEntries: 2048, retentionDays: 7 },
    };

    const logs: string[] = [];
    const sched = new NotificationScheduler(settings, (m) => logs.push(m));

    const base = new Date("2026-01-18T12:00:00.000Z");
    vi.setSystemTime(new Date("2026-01-18T11:50:00.000Z"));

    const ev: Event = {
      calendar: cal("cal1"),
      id: "u1",
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

  it("atStart: если включена autoStartEnabled и есть startRecording — открывает диктофон и не показывает reminder window", async () => {
    vi.useFakeTimers();
    const anyNotice = Notice as unknown as { messages: string[] };
    anyNotice.messages = [];

    const startRecording = vi.fn().mockResolvedValue(undefined);
    const reminderSpy = vi.spyOn(electronWindowReminder, "showElectronReminderWindow").mockImplementation(() => {
      throw new Error("should not show reminder window");
    });

    const settings: AssistantSettings = {
      debug: { enabled: false },
      calendars: [],
      calendar: { autoRefreshEnabled: false, autoRefreshMinutes: 10, myEmail: "", persistentCacheMaxEventsPerCalendar: 2000 },
      caldav: { accounts: [] },
      folders: {
        projects: "Ассистент/Проекты",
        people: "Ассистент/Люди",
        calendarEvents: "Ассистент/Встречи",
        protocols: "Ассистент/Протоколы",
      },
      // minutesBefore > 0, чтобы не планировать "before" в тот же момент что и "start"
      notifications: { enabled: true, minutesBefore: 5, atStart: true },
      recording: {
        chunkMinutes: 5,
        audioBackend: "electron_media_devices",
        gstreamerMicProcessing: "none",
        gstreamerMonitorProcessing: "none",
        autoStartEnabled: true,
        autoStartSeconds: 5,
      },
      agenda: { maxEvents: 50 },
      log: { maxEntries: 2048, retentionDays: 7 },
    };

    const sched = new NotificationScheduler(settings, undefined, { startRecording });
    vi.setSystemTime(new Date("2026-01-18T11:59:59.000Z"));

    const ev: Event = { calendar: cal("cal1"), id: "u1", summary: "Meeting", start: new Date("2026-01-18T12:00:00.000Z") };
    sched.schedule([ev]);

    vi.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(startRecording).toHaveBeenCalledTimes(1);
    expect(reminderSpy).toHaveBeenCalledTimes(0);
    expect(anyNotice.messages).toHaveLength(0);

    reminderSpy.mockRestore();
    vi.useRealTimers();
  });

  it("schedule: если notifications.enabled=false — ничего не планирует", () => {
    vi.useFakeTimers();
    const anyNotice = Notice as unknown as { messages: string[] };
    anyNotice.messages = [];

    const settings: AssistantSettings = {
      debug: { enabled: false },
      calendars: [],
      calendar: { autoRefreshEnabled: false, autoRefreshMinutes: 10, myEmail: "", persistentCacheMaxEventsPerCalendar: 2000 },
      caldav: { accounts: [] },
      folders: {
        projects: "Ассистент/Проекты",
        people: "Ассистент/Люди",
        calendarEvents: "Ассистент/Встречи",
        protocols: "Ассистент/Протоколы",
      },
      notifications: {
        enabled: false,
        minutesBefore: 5,
        atStart: true,
      },
      recording: {
        chunkMinutes: 5,
        audioBackend: "electron_media_devices",
        gstreamerMicProcessing: "none",
        gstreamerMonitorProcessing: "none",
        autoStartEnabled: false,
        autoStartSeconds: 5,
      },
      agenda: { maxEvents: 50 },
      log: { maxEntries: 200, retentionDays: 7 },
    };

    const sched = new NotificationScheduler(settings);
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const ev: Event = { calendar: cal("c"), id: "u", summary: "M", start: new Date("2026-01-01T00:10:00.000Z") };
    sched.schedule([ev]);

    vi.advanceTimersByTime(60 * 60_000);
    expect(anyNotice.messages).toHaveLength(0);
    vi.useRealTimers();
  });

  it("schedule: игнорирует события, которые начались давно (старше 60 секунд)", () => {
    vi.useFakeTimers();
    const anyNotice = Notice as unknown as { messages: string[] };
    anyNotice.messages = [];

    const settings: AssistantSettings = {
      debug: { enabled: false },
      calendars: [],
      calendar: { autoRefreshEnabled: false, autoRefreshMinutes: 10, myEmail: "", persistentCacheMaxEventsPerCalendar: 2000 },
      caldav: { accounts: [] },
      folders: {
        projects: "Ассистент/Проекты",
        people: "Ассистент/Люди",
        calendarEvents: "Ассистент/Встречи",
        protocols: "Ассистент/Протоколы",
      },
      notifications: {
        enabled: true,
        minutesBefore: 0,
        atStart: true,
      },
      recording: {
        chunkMinutes: 5,
        audioBackend: "electron_media_devices",
        gstreamerMicProcessing: "none",
        gstreamerMonitorProcessing: "none",
        autoStartEnabled: false,
        autoStartSeconds: 5,
      },
      agenda: { maxEvents: 50 },
      log: { maxEntries: 200, retentionDays: 7 },
    };

    const sched = new NotificationScheduler(settings);
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const evOld: Event = { calendar: cal("c"), id: "u", summary: "Old", start: new Date("2025-12-31T23:58:00.000Z") };
    sched.schedule([evOld]);

    vi.advanceTimersByTime(5 * 60_000);
    expect(anyNotice.messages).toHaveLength(0);
    vi.useRealTimers();
  });

  it("clear: снимает таймеры и после clear уведомления не приходят", () => {
    vi.useFakeTimers();
    const anyNotice = Notice as unknown as { messages: string[] };
    anyNotice.messages = [];

    const settings: AssistantSettings = {
      debug: { enabled: false },
      calendars: [],
      calendar: { autoRefreshEnabled: false, autoRefreshMinutes: 10, myEmail: "", persistentCacheMaxEventsPerCalendar: 2000 },
      caldav: { accounts: [] },
      folders: {
        projects: "Ассистент/Проекты",
        people: "Ассистент/Люди",
        calendarEvents: "Ассистент/Встречи",
        protocols: "Ассистент/Протоколы",
      },
      notifications: {
        enabled: true,
        minutesBefore: 5,
        atStart: true,
      },
      recording: {
        chunkMinutes: 5,
        audioBackend: "electron_media_devices",
        gstreamerMicProcessing: "none",
        gstreamerMonitorProcessing: "none",
        autoStartEnabled: false,
        autoStartSeconds: 5,
      },
      agenda: { maxEvents: 50 },
      log: { maxEntries: 200, retentionDays: 7 },
    };

    const clearSpy = vi.spyOn(window, "clearTimeout");
    const sched = new NotificationScheduler(settings);
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const ev: Event = { calendar: cal("c"), id: "u", summary: "M", start: new Date("2026-01-01T00:10:00.000Z") };
    sched.schedule([ev]); // должно поставить before + start

    sched.clear();
    expect(clearSpy).toHaveBeenCalled();

    vi.advanceTimersByTime(60 * 60_000);
    expect(anyNotice.messages).toHaveLength(0);
    vi.useRealTimers();
  });

  it("electron_window: если BrowserWindow недоступен (например в тестах), делаем fallback на Notice", async () => {
    const spy = vi.spyOn(electronWindowReminder, "showElectronReminderWindow").mockImplementation(() => {
      throw new Error("no BrowserWindow");
    });
    const settings: AssistantSettings = {
      debug: { enabled: false },
      calendars: [],
      calendar: { autoRefreshEnabled: false, autoRefreshMinutes: 10, myEmail: "", persistentCacheMaxEventsPerCalendar: 2000 },
      caldav: { accounts: [] },
      folders: {
        projects: "Ассистент/Проекты",
        people: "Ассистент/Люди",
        calendarEvents: "Ассистент/Встречи",
        protocols: "Ассистент/Протоколы",
      },
      notifications: {
        enabled: true,
        minutesBefore: 0,
        atStart: false,
      },
      recording: {
        chunkMinutes: 5,
        audioBackend: "electron_media_devices",
        gstreamerMicProcessing: "none",
        gstreamerMonitorProcessing: "none",
        autoStartEnabled: false,
        autoStartSeconds: 5,
      },
      agenda: { maxEvents: 50 },
      log: { maxEntries: 200, retentionDays: 7 },
    };

    const logs: string[] = [];
    const sched = new NotificationScheduler(settings, (m) => logs.push(m));
    const ev: Event = { calendar: cal("c"), id: "u", summary: "M", start: new Date("2026-01-01T00:00:00.000Z") };
    await (sched as any).showGlobal(ev, "m", "before");
    expect(logs.some((x) => x.includes("electron_window: ошибка"))).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it("schedule не планирует события вне горизонта 48 часов", () => {
    vi.useFakeTimers();
    const anyNotice = Notice as unknown as { messages: string[] };
    anyNotice.messages = [];

    const settings: AssistantSettings = {
      debug: { enabled: false },
      calendars: [],
      calendar: { autoRefreshEnabled: false, autoRefreshMinutes: 10, myEmail: "", persistentCacheMaxEventsPerCalendar: 2000 },
      caldav: { accounts: [] },
      folders: {
        projects: "Ассистент/Проекты",
        people: "Ассистент/Люди",
        calendarEvents: "Ассистент/Встречи",
        protocols: "Ассистент/Протоколы",
      },
      notifications: {
        enabled: true,
        minutesBefore: 0,
        atStart: true,
      },
      recording: {
        chunkMinutes: 5,
        audioBackend: "electron_media_devices",
        gstreamerMicProcessing: "none",
        gstreamerMonitorProcessing: "none",
        autoStartEnabled: false,
        autoStartSeconds: 5,
      },
      agenda: { maxEvents: 50 },
      log: { maxEntries: 200, retentionDays: 7 },
    };

    const sched = new NotificationScheduler(settings);
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const evTooFar: Event = { calendar: cal("c"), id: "u", summary: "Far", start: new Date("2026-01-03T01:00:00.000Z") }; // > 48ч
    sched.schedule([evTooFar]);

    vi.advanceTimersByTime(3 * 24 * 60 * 60_000);
    expect(anyNotice.messages).toHaveLength(0);
    vi.useRealTimers();
  });

  // delivery/global legacy paths удалены: теперь всегда используем electron_window.

  it("electron_window: логирует ошибку при невозможности показать окно", async () => {
    const spy = vi.spyOn(electronWindowReminder, "showElectronReminderWindow").mockImplementation(() => {
      throw new Error("boom");
    });
    const settings: AssistantSettings = {
      debug: { enabled: false },
      calendars: [],
      calendar: { autoRefreshEnabled: false, autoRefreshMinutes: 10, myEmail: "", persistentCacheMaxEventsPerCalendar: 2000 },
      caldav: { accounts: [] },
      folders: {
        projects: "Ассистент/Проекты",
        people: "Ассистент/Люди",
        calendarEvents: "Ассистент/Встречи",
        protocols: "Ассистент/Протоколы",
      },
      notifications: {
        enabled: true,
        minutesBefore: 0,
        atStart: false,
      },
      recording: {
        chunkMinutes: 5,
        audioBackend: "electron_media_devices",
        gstreamerMicProcessing: "none",
        gstreamerMonitorProcessing: "none",
        autoStartEnabled: false,
        autoStartSeconds: 5,
      },
      agenda: { maxEvents: 50 },
      log: { maxEntries: 200, retentionDays: 7 },
    };

    const logs: string[] = [];
    const sched = new NotificationScheduler(settings, (m) => logs.push(m));
    const ev: Event = { calendar: cal("c"), id: "u", summary: "M", start: new Date("2026-01-01T00:00:00.000Z") };
    await (sched as any).showGlobal(ev, "m", "before");
    expect(logs.some((x) => x.includes("electron_window: ошибка"))).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it("setSettings влияет на debugShowReminder (и пишет DEBUG лог)", () => {
    const anyNotice = Notice as unknown as { messages: string[] };
    anyNotice.messages = [];

    const settings: AssistantSettings = {
      debug: { enabled: false },
      calendars: [],
      calendar: { autoRefreshEnabled: false, autoRefreshMinutes: 10, myEmail: "", persistentCacheMaxEventsPerCalendar: 2000 },
      caldav: { accounts: [] },
      folders: {
        projects: "Ассистент/Проекты",
        people: "Ассистент/Люди",
        calendarEvents: "Ассистент/Встречи",
        protocols: "Ассистент/Протоколы",
      },
      notifications: {
        enabled: true,
        minutesBefore: 7,
        atStart: false,
      },
      recording: {
        chunkMinutes: 5,
        audioBackend: "electron_media_devices",
        gstreamerMicProcessing: "none",
        gstreamerMonitorProcessing: "none",
        autoStartEnabled: false,
        autoStartSeconds: 5,
      },
      agenda: { maxEvents: 50 },
      log: { maxEntries: 200, retentionDays: 7 },
    };

    const logs: string[] = [];
    const sched = new NotificationScheduler(settings, (m) => logs.push(m));
    const ev: Event = { calendar: cal("c"), id: "u", summary: "Meeting", start: new Date("2026-01-01T10:00:00.000Z") };

    sched.debugShowReminder(ev);
    expect(anyNotice.messages[0]).toContain("Через 7 мин");
    expect(logs.some((x) => x.startsWith("DEBUG уведомление:"))).toBe(true);

    sched.setSettings({
      ...settings,
      notifications: { ...settings.notifications, minutesBefore: 3 },
    });
    sched.debugShowReminder(ev);
    expect(anyNotice.messages[1]).toContain("Через 3 мин");
  });

  it("showGlobal: если electron_window доступен, не делает fallback на Notice", async () => {
    const anyNotice = Notice as unknown as { messages: string[] };
    anyNotice.messages = [];

    const settings: AssistantSettings = {
      debug: { enabled: false },
      calendars: [],
      calendar: { autoRefreshEnabled: false, autoRefreshMinutes: 10, myEmail: "", persistentCacheMaxEventsPerCalendar: 2000 },
      caldav: { accounts: [] },
      folders: {
        projects: "Ассистент/Проекты",
        people: "Ассистент/Люди",
        calendarEvents: "Ассистент/Встречи",
        protocols: "Ассистент/Протоколы",
      },
      notifications: {
        enabled: true,
        minutesBefore: 5,
        atStart: false,
      },
      recording: {
        chunkMinutes: 5,
        audioBackend: "electron_media_devices",
        gstreamerMicProcessing: "none",
        gstreamerMonitorProcessing: "none",
        autoStartEnabled: false,
        autoStartSeconds: 5,
      },
      agenda: { maxEvents: 50 },
      log: { maxEntries: 200, retentionDays: 7 },
    };

    const logs: string[] = [];
    const sched = new NotificationScheduler(settings, (m) => logs.push(m));
    const ev: Event = { calendar: cal("c"), id: "u", summary: "M", start: new Date("2026-01-01T00:10:00.000Z") };

    const spy = vi.spyOn(electronWindowReminder, "showElectronReminderWindow").mockImplementation(() => true);
    await (sched as any).showGlobal(ev, "m", "before");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(anyNotice.messages).toHaveLength(0);
    expect(logs.some((x) => x.startsWith("Показано уведомление:"))).toBe(true);
  });

  it("fallback-path: если electron_window недоступен (нет BrowserWindow) — пишем лог и показываем Notice", async () => {
    const anyNotice = Notice as unknown as { messages: string[] };
    anyNotice.messages = [];

    // Убедимся, что в этом тесте нет глобального мока electron.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).__assistantElectronMock;

    const settings: AssistantSettings = {
      debug: { enabled: false },
      calendars: [],
      calendar: { autoRefreshEnabled: false, autoRefreshMinutes: 10, myEmail: "", persistentCacheMaxEventsPerCalendar: 2000 },
      caldav: { accounts: [] },
      folders: {
        projects: "Ассистент/Проекты",
        people: "Ассистент/Люди",
        calendarEvents: "Ассистент/Встречи",
        protocols: "Ассистент/Протоколы",
      },
      notifications: {
        enabled: true,
        minutesBefore: 0,
        atStart: false,
      },
      recording: {
        chunkMinutes: 5,
        audioBackend: "electron_media_devices",
        gstreamerMicProcessing: "none",
        gstreamerMonitorProcessing: "none",
        autoStartEnabled: false,
        autoStartSeconds: 5,
      },
      agenda: { maxEvents: 50 },
      log: { maxEntries: 200, retentionDays: 7 },
    };

    const logs: string[] = [];
    const sched = new NotificationScheduler(settings, (m) => logs.push(m));
    const ev: Event = { calendar: cal("c"), id: "u", summary: "M", start: new Date("2026-01-01T00:00:00.000Z") };
    await (sched as any).showGlobal(ev, "m", "before");

    expect(logs.some((x) => x.includes("electron_window: недоступен"))).toBe(true);
    expect(anyNotice.messages).toHaveLength(1);
  });

  it("catch-path: если electron_window бросает undefined, лог пишет 'неизвестно' (ветка ??)", async () => {
    const anyNotice = Notice as unknown as { messages: string[] };
    anyNotice.messages = [];

    const settings: AssistantSettings = {
      debug: { enabled: false },
      calendars: [],
      calendar: { autoRefreshEnabled: false, autoRefreshMinutes: 10, myEmail: "", persistentCacheMaxEventsPerCalendar: 2000 },
      caldav: { accounts: [] },
      folders: {
        projects: "Ассистент/Проекты",
        people: "Ассистент/Люди",
        calendarEvents: "Ассистент/Встречи",
        protocols: "Ассистент/Протоколы",
      },
      notifications: {
        enabled: true,
        minutesBefore: 0,
        atStart: false,
      },
      recording: {
        chunkMinutes: 5,
        audioBackend: "electron_media_devices",
        gstreamerMicProcessing: "none",
        gstreamerMonitorProcessing: "none",
        autoStartEnabled: false,
        autoStartSeconds: 5,
      },
      agenda: { maxEvents: 50 },
      log: { maxEntries: 200, retentionDays: 7 },
    };

    const logs: string[] = [];
    const sched = new NotificationScheduler(settings, (m) => logs.push(m));
    const ev: Event = { calendar: cal("c"), id: "u", summary: "M", start: new Date("2026-01-01T00:00:00.000Z") };

    const spy = vi.spyOn(electronWindowReminder, "showElectronReminderWindow").mockImplementation(() => {
      // eslint-disable-next-line no-throw-literal
      throw undefined;
    });

    await (sched as any).showGlobal(ev, "m", "before");
    expect(spy).toHaveBeenCalled();
    expect(logs.some((x) => x.includes("electron_window: ошибка (неизвестно)"))).toBe(true);
    expect(anyNotice.messages).toHaveLength(1);
  });

  it("formatEvent: для allDay=true использует 'весь день'", () => {
    vi.useFakeTimers();
    const anyNotice = Notice as unknown as { messages: string[] };
    anyNotice.messages = [];

    const settings: AssistantSettings = {
      debug: { enabled: false },
      calendars: [],
      calendar: { autoRefreshEnabled: false, autoRefreshMinutes: 10, myEmail: "", persistentCacheMaxEventsPerCalendar: 2000 },
      caldav: { accounts: [] },
      folders: {
        projects: "Ассистент/Проекты",
        people: "Ассистент/Люди",
        calendarEvents: "Ассистент/Встречи",
        protocols: "Ассистент/Протоколы",
      },
      notifications: {
        enabled: true,
        minutesBefore: 0,
        atStart: false,
      },
      recording: {
        chunkMinutes: 5,
        audioBackend: "electron_media_devices",
        gstreamerMicProcessing: "none",
        gstreamerMonitorProcessing: "none",
        autoStartEnabled: false,
        autoStartSeconds: 5,
      },
      agenda: { maxEvents: 50 },
      log: { maxEntries: 200, retentionDays: 7 },
    };

    // Принудительно в fallback, чтобы создать Notice с msg.
    vi.spyOn(electronWindowReminder, "showElectronReminderWindow").mockImplementation(() => {
      throw new Error("no BrowserWindow");
    });

    const sched = new NotificationScheduler(settings);
    const ev: Event = { calendar: cal("c"), id: "u", summary: "AllDay", allDay: true, start: new Date("2026-01-01T00:00:00.000Z") };
    sched.debugShowReminder(ev);
    expect(anyNotice.messages[0]).toContain("весь день");
    vi.useRealTimers();
  });
});
