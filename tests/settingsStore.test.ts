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

  it("normalizeSettings: recording.audioBackend по умолчанию electron_desktop_capturer и валидируется", () => {
    expect(normalizeSettings({}).recording.audioBackend).toBe("electron_desktop_capturer");
    expect(normalizeSettings({ recording: { audioBackend: "linux_native" } }).recording.audioBackend).toBe("linux_native");
    // мусор -> default
    expect(normalizeSettings({ recording: { audioBackend: "???lol" } as any }).recording.audioBackend).toBe("electron_desktop_capturer");
  });
});
