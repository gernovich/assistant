import { describe, expect, it, vi } from "vitest";
import { Notice } from "obsidian";
import { NotificationScheduler } from "../src/notifications/notificationScheduler";
import type { AssistantSettings, CalendarEvent } from "../src/types";

describe("NotificationScheduler", () => {
  it("fires 'before' and 'atStart' notifications", () => {
    vi.useFakeTimers();
    const anyNotice = Notice as unknown as { messages: string[] };
    anyNotice.messages = [];

    const settings: AssistantSettings = {
      debug: { enabled: false },
      calendars: [],
      calendar: { autoRefreshEnabled: false, autoRefreshMinutes: 10, myEmail: "" },
      folders: {
        logs: "Ассистент/Логи",
        projects: "Ассистент/Проекты",
        people: "Ассистент/Люди",
        calendarEvents: "Ассистент/Встречи",
        protocols: "Ассистент/Протоколы",
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
      log: { maxEntries: 200, writeToVault: false },
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
});

