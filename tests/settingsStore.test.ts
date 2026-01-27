import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/settingsStore";

describe("settingsStore", () => {
  it("normalizeSettings заполняет persistentCacheMaxEventsPerCalendar по умолчанию", () => {
    const s = normalizeSettings({});
    expect(s.calendar.persistentCacheMaxEventsPerCalendar).toBe(DEFAULT_SETTINGS.calendar.persistentCacheMaxEventsPerCalendar);
  });

  it("normalizeSettings нормализует persistentCacheMaxEventsPerCalendar в разумные границы", () => {
    expect(normalizeSettings({ calendar: { persistentCacheMaxEventsPerCalendar: 0 } }).calendar.persistentCacheMaxEventsPerCalendar).toBe(
      1,
    );
    expect(normalizeSettings({ calendar: { persistentCacheMaxEventsPerCalendar: 1 } }).calendar.persistentCacheMaxEventsPerCalendar).toBe(
      1,
    );
    expect(
      normalizeSettings({ calendar: { persistentCacheMaxEventsPerCalendar: 999999 } }).calendar.persistentCacheMaxEventsPerCalendar,
    ).toBe(20_000);
    expect(
      normalizeSettings({ calendar: { persistentCacheMaxEventsPerCalendar: "123" } }).calendar.persistentCacheMaxEventsPerCalendar,
    ).toBe(123);
  });

  it("normalizeSettings: recording.audioBackend по умолчанию electron_media_devices и валидируется (+ backward compat)", () => {
    expect(normalizeSettings({}).recording.audioBackend).toBe("electron_media_devices");
    expect(normalizeSettings({ recording: { audioBackend: "g_streamer" } }).recording.audioBackend).toBe("g_streamer");
    // backward compat
    expect(normalizeSettings({ recording: { audioBackend: "electron_desktop_capturer" } as any }).recording.audioBackend).toBe(
      "electron_media_devices",
    );
    // мусор -> default
    expect(normalizeSettings({ recording: { audioBackend: "???lol" } as any }).recording.audioBackend).toBe("electron_media_devices");
  });

  it("normalizeSettings: не падает на битом data.json и использует defaults", () => {
    const s = normalizeSettings({
      calendars: "oops",
      calendar: { autoRefreshMinutes: "bad" },
      // backward compat: старая настройка, сейчас не используется, но может встречаться в data.json
      protocols: { subfoldersByMeeting: "true" },
      recording: { autoStartEnabled: "yes", autoStartSeconds: "nope" },
      notifications: { minutesBefore: "wat" },
      log: { maxEntries: "x" },
      agenda: { maxEvents: "x" },
      caldav: { accounts: [{ id: 1, name: true }] },
    });
    expect(s).toBeTruthy();
    expect(s.recording.autoStartEnabled).toBe(DEFAULT_SETTINGS.recording.autoStartEnabled);
    expect(s.recording.autoStartSeconds).toBe(DEFAULT_SETTINGS.recording.autoStartSeconds);
    expect(s.notifications.minutesBefore).toBe(DEFAULT_SETTINGS.notifications.minutesBefore);
    expect(s.calendar.autoRefreshMinutes).toBe(DEFAULT_SETTINGS.calendar.autoRefreshMinutes);
  });

  it("normalizeSettings: принимает числовые значения, пришедшие строками", () => {
    const s = normalizeSettings({
      calendar: { autoRefreshMinutes: "15" },
      notifications: { minutesBefore: "7" },
      recording: { chunkMinutes: "9", autoStartSeconds: "3" },
      agenda: { maxEvents: "120" },
      log: { maxEntries: "1234", retentionDays: "9" },
    });
    expect(s.calendar.autoRefreshMinutes).toBe(15);
    expect(s.notifications.minutesBefore).toBe(7);
    expect(s.recording.chunkMinutes).toBe(9);
    expect(s.recording.autoStartSeconds).toBe(3);
    expect(s.agenda.maxEvents).toBe(120);
    expect(s.log.maxEntries).toBe(1234);
    expect(s.log.retentionDays).toBe(9);
  });
});
