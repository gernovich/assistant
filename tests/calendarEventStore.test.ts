import { describe, expect, it } from "vitest";
import { CalendarEventStore } from "../src/calendar/store/calendarEventStore";
import type { CalendarEvent } from "../src/types";

function ev(calendarId: string, uid: string, startIso: string): CalendarEvent {
  return {
    calendarId,
    uid,
    summary: `${calendarId}:${uid}`,
    start: new Date(startIso),
    end: new Date(new Date(startIso).getTime() + 30 * 60_000),
  };
}

describe("CalendarEventStore", () => {
  it("объединяет lastGood события только для enabled календарей и сортирует по start", () => {
    const store = new CalendarEventStore();

    store.applyBatch({
      enabledCalendarIds: ["a", "b"],
      results: [
        { calendarId: "b", ok: true, fetchedAt: 10, events: [ev("b", "1", "2026-01-03T10:00:00.000Z")] },
        { calendarId: "a", ok: true, fetchedAt: 11, events: [ev("a", "1", "2026-01-02T10:00:00.000Z")] },
      ],
    });

    const events = store.getEvents();
    expect(events.map((e) => e.calendarId)).toEqual(["a", "b"]);
    expect(events[0].start.toISOString()).toBe("2026-01-02T10:00:00.000Z");
    expect(events[1].start.toISOString()).toBe("2026-01-03T10:00:00.000Z");
  });

  it("при ошибке refresh помечает календарь stale и сохраняет lastGood события", () => {
    const store = new CalendarEventStore();

    store.applyBatch({
      enabledCalendarIds: ["a"],
      results: [{ calendarId: "a", ok: true, fetchedAt: 1000, events: [ev("a", "u1", "2026-01-01T10:00:00.000Z")] }],
    });

    store.applyBatch({
      enabledCalendarIds: ["a"],
      results: [{ calendarId: "a", ok: false, error: "boom" }],
    });

    const status = store.getPerCalendarStatus();
    expect(status["a"].status).toBe("stale");
    expect(status["a"]).toMatchObject({ fetchedAt: 1000, error: "boom" });
    expect(store.getEvents()).toHaveLength(1);
  });

  it("удаляет статусы и события для отключённых календарей", () => {
    const store = new CalendarEventStore();
    store.applyBatch({
      enabledCalendarIds: ["a", "b"],
      results: [
        { calendarId: "a", ok: true, fetchedAt: 1, events: [ev("a", "1", "2026-01-01T10:00:00.000Z")] },
        { calendarId: "b", ok: true, fetchedAt: 2, events: [ev("b", "1", "2026-01-02T10:00:00.000Z")] },
      ],
    });

    store.applyBatch({
      enabledCalendarIds: ["a"], // b выключили
      results: [{ calendarId: "a", ok: true, fetchedAt: 3, events: [ev("a", "2", "2026-01-03T10:00:00.000Z")] }],
    });

    const status = store.getPerCalendarStatus();
    expect(status["b"]).toBeUndefined();
    expect(store.getEvents().every((e) => e.calendarId === "a")).toBe(true);
  });
});
