import { describe, expect, it } from "vitest";
import { CalendarService } from "../src/calendar/calendarService";
import type { CalendarConfig, Event } from "../src/types";
import type { CalendarProvider } from "../src/calendar/providers/calendarProvider";
import type { CalendarProviderRegistry } from "../src/calendar/providers/calendarProviderRegistry";
import { DEFAULT_SETTINGS } from "../src/settingsStore";
import { makeCalendarStub } from "../src/domain/policies/calendarStub";

class FakeRegistry implements CalendarProviderRegistry {
  rsvpWriter = undefined;
  private byType = new Map<CalendarConfig["type"], CalendarProvider>();
  constructor(providers: CalendarProvider[]) {
    for (const p of providers) this.byType.set(p.type, p);
  }
  get(type: CalendarConfig["type"]): CalendarProvider | undefined {
    return this.byType.get(type);
  }
  setSettings(): void {
    // ignore
  }
}

function makeEvent(params: { calendarId: string; calendarName: string; type: CalendarConfig["type"]; id: string; start: string }): Event {
  return {
    calendar: makeCalendarStub({ id: params.calendarId, name: params.calendarName, type: params.type }),
    id: params.id,
    summary: `ev:${params.id}`,
    start: new Date(params.start),
    end: new Date(new Date(params.start).getTime() + 60_000),
  };
}

describe("calendar/calendarService refresh flows (fake providers)", () => {
  it("refreshAll: success -> statuses fresh and merged events are updated", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.calendars = [
      { id: "c1", name: "Cal 1", type: "ics_url", enabled: true, url: "x" },
      { id: "c2", name: "Cal 2", type: "ics_url", enabled: true, url: "y" },
    ];

    const provider: CalendarProvider = {
      type: "ics_url",
      async refresh(cal) {
        if (cal.id === "c1")
          return [makeEvent({ calendarId: "c1", calendarName: "Cal 1", type: "ics_url", id: "a", start: "2026-01-01T10:00:00.000Z" })];
        if (cal.id === "c2")
          return [makeEvent({ calendarId: "c2", calendarName: "Cal 2", type: "ics_url", id: "b", start: "2026-01-01T09:00:00.000Z" })];
        return [];
      },
    };

    const svc = new CalendarService(settings, new FakeRegistry([provider]));
    const { errors } = await svc.refreshAll();
    expect(errors).toEqual([]);

    const rr = svc.getRefreshResult();
    expect(rr.events.map((e) => `${e.calendar.id}:${e.id}`)).toEqual(["c2:b", "c1:a"]); // sorted by start
    expect(rr.perCalendar.c1.status).toBe("fresh");
    expect(rr.perCalendar.c2.status).toBe("fresh");
  });

  it("refreshAll: partial failure keeps lastGood for failed calendar (stale + error)", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.calendars = [
      { id: "ok", name: "OK", type: "ics_url", enabled: true, url: "x" },
      { id: "bad", name: "BAD", type: "ics_url", enabled: true, url: "y" },
    ];

    const provider: CalendarProvider = {
      type: "ics_url",
      async refresh(cal) {
        if (cal.id === "ok") {
          return [makeEvent({ calendarId: "ok", calendarName: "OK", type: "ics_url", id: "n1", start: "2026-01-02T10:00:00.000Z" })];
        }
        if (cal.id === "bad") throw new Error("net down");
        return [];
      },
    };

    const svc = new CalendarService(settings, new FakeRegistry([provider]));

    // seed lastGood for "bad"
    svc.seedFromCache({
      enabledCalendarIds: ["ok", "bad"],
      lastGood: {
        bad: {
          fetchedAt: 123,
          events: [makeEvent({ calendarId: "bad", calendarName: "BAD", type: "ics_url", id: "old", start: "2026-01-01T10:00:00.000Z" })],
        },
      },
    });

    const { errors } = await svc.refreshAll();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.calendarId).toBe("bad");

    const rr = svc.getRefreshResult();
    expect(rr.perCalendar.ok.status).toBe("fresh");
    expect(rr.perCalendar.bad.status).toBe("stale");
    if (rr.perCalendar.bad.status === "stale") {
      expect(rr.perCalendar.bad.fetchedAt).toBe(123);
      expect(rr.perCalendar.bad.error).toContain("net down");
    }

    // merged includes ok(new) + bad(lastGood)
    expect(rr.events.map((e) => `${e.calendar.id}:${e.id}`)).toEqual(["bad:old", "ok:n1"]);
  });

  it("refreshOneAndMerge: calendar not found -> returns error and does not change state", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.calendars = [{ id: "c1", name: "Cal 1", type: "ics_url", enabled: true, url: "x" }];

    const provider: CalendarProvider = {
      type: "ics_url",
      async refresh() {
        return [makeEvent({ calendarId: "c1", calendarName: "Cal 1", type: "ics_url", id: "a", start: "2026-01-01T10:00:00.000Z" })];
      },
    };

    const svc = new CalendarService(settings, new FakeRegistry([provider]));
    await svc.refreshAll();
    const before = svc.getRefreshResult();

    const res = await svc.refreshOneAndMerge("missing");
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]?.error).toContain("не найден");

    const after = svc.getRefreshResult();
    expect(after.events).toEqual(before.events);
    expect(after.perCalendar).toEqual(before.perCalendar);
  });

  it("refreshOneAndMerge: calendar disabled -> returns error and does not change state", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.calendars = [
      { id: "c1", name: "Cal 1", type: "ics_url", enabled: true, url: "x" },
      { id: "off", name: "Off", type: "ics_url", enabled: false, url: "y" },
    ];

    const provider: CalendarProvider = {
      type: "ics_url",
      async refresh(cal) {
        if (cal.id === "c1")
          return [makeEvent({ calendarId: "c1", calendarName: "Cal 1", type: "ics_url", id: "a", start: "2026-01-01T10:00:00.000Z" })];
        throw new Error("should not be called");
      },
    };

    const svc = new CalendarService(settings, new FakeRegistry([provider]));
    await svc.refreshAll();
    const before = svc.getRefreshResult();

    const res = await svc.refreshOneAndMerge("off");
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]?.error).toContain("отключ");

    const after = svc.getRefreshResult();
    expect(after.events).toEqual(before.events);
    expect(after.perCalendar).toEqual(before.perCalendar);
  });

  it("refreshOneAndMerge: provider missing -> ok, marks calendar fresh with empty events", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    // calendar type with no provider in registry
    settings.calendars = [{ id: "c1", name: "Cal 1", type: "caldav", enabled: true }];

    const svc = new CalendarService(settings, new FakeRegistry([]));
    const { errors } = await svc.refreshOneAndMerge("c1");
    expect(errors).toEqual([]);

    const rr = svc.getRefreshResult();
    expect(rr.events).toEqual([]);
    expect(rr.perCalendar.c1.status).toBe("fresh");
  });

  it("refreshAll: disabled calendar status is removed from perCalendar", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.calendars = [
      { id: "c1", name: "Cal 1", type: "ics_url", enabled: true, url: "x" },
      { id: "off", name: "Off", type: "ics_url", enabled: false, url: "y" },
    ];

    const provider: CalendarProvider = {
      type: "ics_url",
      async refresh(cal) {
        if (cal.id === "c1")
          return [makeEvent({ calendarId: "c1", calendarName: "Cal 1", type: "ics_url", id: "a", start: "2026-01-01T10:00:00.000Z" })];
        throw new Error("should not be called");
      },
    };

    const svc = new CalendarService(settings, new FakeRegistry([provider]));

    // seed stale status for disabled calendar
    svc.seedFromCache({
      enabledCalendarIds: ["c1", "off"],
      lastGood: {
        off: {
          fetchedAt: 10,
          events: [makeEvent({ calendarId: "off", calendarName: "Off", type: "ics_url", id: "old", start: "2026-01-01T09:00:00.000Z" })],
        },
      },
    });
    expect(svc.getRefreshResult().perCalendar.off?.status).toBe("stale");

    await svc.refreshAll();
    const rr = svc.getRefreshResult();
    expect(rr.perCalendar.off).toBeUndefined();
    expect(rr.events.map((e) => `${e.calendar.id}:${e.id}`)).toEqual(["c1:a"]); // disabled cache should not leak
  });

  it("refreshAll: provider missing for one enabled calendar -> calendar is fresh with empty events", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.calendars = [
      { id: "c1", name: "ICS", type: "ics_url", enabled: true, url: "x" },
      { id: "c2", name: "CalDAV", type: "caldav", enabled: true },
    ];

    const provider: CalendarProvider = {
      type: "ics_url",
      async refresh(cal) {
        if (cal.id === "c1")
          return [makeEvent({ calendarId: "c1", calendarName: "ICS", type: "ics_url", id: "a", start: "2026-01-01T10:00:00.000Z" })];
        return [];
      },
    };

    const svc = new CalendarService(settings, new FakeRegistry([provider])); // no caldav provider
    const { errors } = await svc.refreshAll();
    expect(errors).toEqual([]);

    const rr = svc.getRefreshResult();
    expect(rr.perCalendar.c1.status).toBe("fresh");
    expect(rr.perCalendar.c2.status).toBe("fresh");
    expect(rr.events.map((e) => `${e.calendar.id}:${e.id}`)).toEqual(["c1:a"]);
  });

  it("refreshAll: failure without lastGood -> calendar becomes stale and merged events stay empty", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.calendars = [{ id: "bad", name: "BAD", type: "ics_url", enabled: true, url: "x" }];

    const provider: CalendarProvider = {
      type: "ics_url",
      async refresh() {
        throw new Error("net down");
      },
    };

    const svc = new CalendarService(settings, new FakeRegistry([provider]));
    const { errors } = await svc.refreshAll();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.calendarId).toBe("bad");

    const rr = svc.getRefreshResult();
    expect(rr.perCalendar.bad.status).toBe("stale");
    if (rr.perCalendar.bad.status === "stale") {
      expect(rr.perCalendar.bad.fetchedAt).toBeUndefined();
      expect(rr.perCalendar.bad.error).toContain("net down");
    }
    expect(rr.events).toEqual([]);
  });
});
