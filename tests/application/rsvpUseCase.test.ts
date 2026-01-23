import { describe, expect, it, vi } from "vitest";
import { RsvpUseCase } from "../../src/application/calendar/rsvpUseCase";
import { DEFAULT_SETTINGS } from "../../src/settingsStore";
import type { AssistantSettings, Event } from "../../src/types";

function makeSettings(overrides?: Partial<AssistantSettings>): AssistantSettings {
  return { ...structuredClone(DEFAULT_SETTINGS), ...(overrides ?? {}) } as AssistantSettings;
}

function makeEvent(params?: Partial<Event>): Event {
  return {
    calendar: { id: "cal", name: "Cal", type: "caldav", config: { id: "cal", name: "Cal", type: "caldav", enabled: true, caldav: { accountId: "a1", calendarUrl: "" } } },
    id: "ev",
    summary: "Meet",
    start: new Date("2020-01-01T10:00:00Z"),
    attendees: [],
    ...params,
  } as Event;
}

describe("RsvpUseCase", () => {
  it("если нельзя определить мой email — делает notice и не вызывает setMyPartstat", async () => {
    const notice = vi.fn();
    const setMyPartstatInCalendar = vi.fn();
    const log = { error: vi.fn() };

    const settings = makeSettings({
      calendar: { ...DEFAULT_SETTINGS.calendar, myEmail: "" },
      calendars: [{ id: "cal", name: "Cal", type: "caldav", enabled: true, caldav: { accountId: "a1", calendarUrl: "" } }],
      caldav: { accounts: [{ id: "a1", name: "acc", enabled: true, serverUrl: "", username: "", password: "" }] },
    });

    const uc = new RsvpUseCase({
      getSettings: () => settings,
      setMyPartstatInCalendar: setMyPartstatInCalendar as any,
      notice,
      log,
    });

    const r = await uc.setMyPartstat(makeEvent({ attendees: [{ email: "me@example.com" }] }), "accepted");
    expect(r.ok).toBe(false);
    expect(notice).toHaveBeenCalled();
    expect(setMyPartstatInCalendar).not.toHaveBeenCalled();
  });

  it("если моего email нет среди ATTENDEE — делает notice и не вызывает setMyPartstat", async () => {
    const notice = vi.fn();
    const setMyPartstatInCalendar = vi.fn();
    const log = { error: vi.fn() };

    const settings = makeSettings({
      calendar: { ...DEFAULT_SETTINGS.calendar, myEmail: "me@example.com" },
      calendars: [{ id: "cal", name: "Cal", type: "caldav", enabled: true, caldav: { accountId: "a1", calendarUrl: "" } }],
      caldav: { accounts: [{ id: "a1", name: "acc", enabled: true, serverUrl: "", username: "me@example.com", password: "" }] },
    });

    const uc = new RsvpUseCase({
      getSettings: () => settings,
      setMyPartstatInCalendar: setMyPartstatInCalendar as any,
      notice,
      log,
    });

    const r = await uc.setMyPartstat(makeEvent({ attendees: [{ email: "other@example.com" }] }), "accepted");
    expect(r.ok).toBe(false);
    expect(notice).toHaveBeenCalled();
    expect(setMyPartstatInCalendar).not.toHaveBeenCalled();
  });

  it("happy path — вызывает setMyPartstat один раз", async () => {
    const notice = vi.fn();
    const setMyPartstatInCalendar = vi.fn().mockResolvedValue(undefined);
    const log = { error: vi.fn() };

    const settings = makeSettings({
      calendar: { ...DEFAULT_SETTINGS.calendar, myEmail: "me@example.com" },
      calendars: [{ id: "cal", name: "Cal", type: "caldav", enabled: true, caldav: { accountId: "a1", calendarUrl: "" } }],
      caldav: { accounts: [{ id: "a1", name: "acc", enabled: true, serverUrl: "", username: "me@example.com", password: "" }] },
    });

    const uc = new RsvpUseCase({
      getSettings: () => settings,
      setMyPartstatInCalendar: setMyPartstatInCalendar as any,
      notice,
      log,
    });

    const r = await uc.setMyPartstat(makeEvent({ attendees: [{ email: "mailto:me@example.com" }] }), "accepted");
    expect(r.ok).toBe(true);
    expect(setMyPartstatInCalendar).toHaveBeenCalledTimes(1);
  });
});

