import { describe, expect, it } from "vitest";
import { CalendarService } from "../src/calendar/calendarService";
import type { AssistantSettings, Calendar, Event } from "../src/types";

function cal(id: string): Calendar {
  return { id, name: id, type: "ics_url", config: { id, name: id, type: "ics_url", enabled: true } };
}

function makeSettings(): AssistantSettings {
  return {
    debug: { enabled: false },
    calendars: [],
    calendar: {
      autoRefreshEnabled: false,
      autoRefreshMinutes: 10,
      myEmail: "",
      persistentCacheMaxEventsPerCalendar: 2000,
    },
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
      audioBackend: "electron_desktop_capturer",
      linuxNativeAudioProcessing: "normalize",
      autoStartEnabled: false,
      autoStartSeconds: 5,
    },
    agenda: { maxEvents: 50 },
    log: { maxEntries: 2048, retentionDays: 7 },
  };
}

describe("calendar/calendarService", () => {
  it("getRefreshResult возвращает единый срез состояния после seedFromCache", () => {
    const svc = new CalendarService(makeSettings());
    const ev: Event = {
      calendar: cal("calA"),
      id: "u1",
      summary: "Событие",
      start: new Date("2026-01-01T10:00:00.000Z"),
      end: new Date("2026-01-01T11:00:00.000Z"),
    };
    svc.seedFromCache({ enabledCalendarIds: ["calA"], lastGood: { calA: { fetchedAt: 123, events: [ev] } } });

    const rr = svc.getRefreshResult();
    expect(rr.updatedAt).toBeGreaterThan(0);
    expect(rr.events).toHaveLength(1);
    expect(rr.events[0].summary).toBe("Событие");
    expect(rr.perCalendar.calA.status).toBe("stale");
    expect(rr.perCalendar.calA.fetchedAt).toBe(123);
  });
});
