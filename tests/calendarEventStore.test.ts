import { describe, expect, it } from "vitest";
import { CalendarEventStore } from "../src/calendar/store/calendarEventStore";
import type { Calendar, Event } from "../src/types";

function cal(id: string): Calendar {
  return { id, name: id, type: "ics_url", config: { id, name: id, type: "ics_url", enabled: true } };
}

function ev(calendarId: string, id: string, startIso: string): Event {
  return {
    calendar: cal(calendarId),
    id,
    summary: `${calendarId}:${id}`,
    start: new Date(startIso),
    end: new Date(new Date(startIso).getTime() + 30 * 60_000),
  };
}

function evLocal(calendarId: string, id: string, y: number, m0: number, d: number, hh: number, mm: number): Event {
  const start = new Date(y, m0, d, hh, mm, 0, 0);
  return {
    calendar: cal(calendarId),
    id,
    summary: `${calendarId}:${id}`,
    start,
    end: new Date(start.getTime() + 30 * 60_000),
  };
}

describe("CalendarEventStore", () => {
  it("seedFromCache помечает данные как stale и отдаёт события только для enabled календарей", () => {
    const store = new CalendarEventStore();
    store.seedFromCache({
      enabledCalendarIds: ["a"],
      lastGood: {
        a: { fetchedAt: 10, events: [ev("a", "1", "2026-01-01T10:00:00.000Z")] },
        b: { fetchedAt: 11, events: [ev("b", "1", "2026-01-02T10:00:00.000Z")] },
      },
    });

    const status = store.getPerCalendarStatus();
    expect(status["a"]).toMatchObject({ status: "stale", fetchedAt: 10 });
    expect(status["b"]).toMatchObject({ status: "stale", fetchedAt: 11 });
    expect(store.getEvents().map((e) => e.calendar.id)).toEqual(["a"]);
  });

  it("exportLastGoodSnapshot возвращает копии lastGood событий и фильтрует по enabledCalendarIds", () => {
    const store = new CalendarEventStore();
    store.applyBatch({
      enabledCalendarIds: ["a", "b"],
      results: [
        { calendarId: "a", ok: true, fetchedAt: 1, events: [ev("a", "1", "2026-01-01T10:00:00.000Z")] },
        { calendarId: "b", ok: true, fetchedAt: 2, events: [ev("b", "1", "2026-01-02T10:00:00.000Z")] },
      ],
    });

    const snap = store.exportLastGoodSnapshot({ enabledCalendarIds: ["b"] });
    expect(Object.keys(snap)).toEqual(["b"]);
    expect(snap.b.fetchedAt).toBe(2);
    expect(snap.b.events).toHaveLength(1);

    // Копия: не должен протекать “внутренний” массив
    snap.b.events.push(ev("b", "x", "2026-01-03T10:00:00.000Z"));
    expect(store.getEvents().filter((e) => e.calendar.id === "b")).toHaveLength(1);
  });

  it("getDay возвращает события на день (локальная дата) с учётом dayOffset", () => {
    const store = new CalendarEventStore();
    store.applyBatch({
      enabledCalendarIds: ["a"],
      results: [
        {
          calendarId: "a",
          ok: true,
          fetchedAt: 1,
          events: [evLocal("a", "d0", 2026, 0, 10, 10, 0), evLocal("a", "d1", 2026, 0, 11, 10, 0)],
        },
      ],
    });

    const base = new Date(2026, 0, 10, 12, 0, 0, 0);
    expect(store.getDay(0, { baseDate: base }).map((e) => e.id)).toEqual(["d0"]);
    expect(store.getDay(1, { baseDate: base }).map((e) => e.id)).toEqual(["d1"]);
  });

  it("getRange returns [] for invalid range (end <= start) and for NaN dates", () => {
    const store = new CalendarEventStore();
    store.applyBatch({
      enabledCalendarIds: ["a"],
      results: [{ calendarId: "a", ok: true, fetchedAt: 1, events: [ev("a", "1", "2026-01-01T10:00:00.000Z")] }],
    });

    expect(store.getRange(new Date("2026-01-01T10:00:00.000Z"), new Date("2026-01-01T10:00:00.000Z"))).toEqual([]);
    expect(store.getRange(new Date("bad-date"), new Date("2026-01-01T10:00:00.000Z"))).toEqual([]);
  });

  it("getUpcoming returns [] for invalid horizon", () => {
    const store = new CalendarEventStore();
    expect(store.getUpcoming(0, Date.now())).toEqual([]);
    expect(store.getUpcoming(Number.NaN, Date.now())).toEqual([]);
  });

  it("getUpcoming возвращает события в горизонте по start (и включает события чуть в прошлом)", () => {
    const store = new CalendarEventStore();
    store.applyBatch({
      enabledCalendarIds: ["a"],
      results: [
        {
          calendarId: "a",
          ok: true,
          fetchedAt: 1,
          events: [
            evLocal("a", "past", 2026, 0, 10, 9, 59),
            evLocal("a", "soon", 2026, 0, 10, 10, 1),
            evLocal("a", "far", 2026, 0, 10, 12, 0),
          ],
        },
      ],
    });

    const now = new Date(2026, 0, 10, 10, 0, 0, 0).getTime();
    const out = store.getUpcoming(2 * 60 * 60_000, now).map((e) => e.id);
    expect(out).toEqual(["past", "soon"]);
  });

  it("getUpcoming возвращает пусто для невалидного horizonMs", () => {
    const store = new CalendarEventStore();
    store.applyBatch({
      enabledCalendarIds: ["a"],
      results: [{ calendarId: "a", ok: true, fetchedAt: 1, events: [evLocal("a", "x", 2026, 0, 10, 10, 0)] }],
    });
    const now = new Date(2026, 0, 10, 10, 0, 0, 0).getTime();
    expect(store.getUpcoming(0, now)).toEqual([]);
    expect(store.getUpcoming(-1, now)).toEqual([]);
    expect(store.getUpcoming(Number.NaN as any, now)).toEqual([]);
  });

  it("getRange возвращает события в диапазоне start<=t<end", () => {
    const store = new CalendarEventStore();
    store.applyBatch({
      enabledCalendarIds: ["a"],
      results: [
        { calendarId: "a", ok: true, fetchedAt: 1, events: [ev("a", "1", "2026-01-10T10:00:00"), ev("a", "2", "2026-01-10T11:00:00")] },
      ],
    });

    const start = new Date("2026-01-10T10:30:00");
    const end = new Date("2026-01-10T11:00:00");
    expect(store.getRange(start, end).map((e) => e.id)).toEqual([]);
    const end2 = new Date("2026-01-10T11:00:00.001");
    expect(store.getRange(start, end2).map((e) => e.id)).toEqual(["2"]);
  });

  it("getRange возвращает пусто для невалидного диапазона", () => {
    const store = new CalendarEventStore();
    store.applyBatch({
      enabledCalendarIds: ["a"],
      results: [{ calendarId: "a", ok: true, fetchedAt: 1, events: [ev("a", "1", "2026-01-10T10:00:00")] }],
    });

    expect(store.getRange(new Date("2026-01-10T10:00:00"), new Date("2026-01-10T10:00:00"))).toEqual([]);
    expect(store.getRange(new Date("invalid"), new Date("2026-01-10T10:00:00"))).toEqual([]);
  });

  it("getByEventKey находит событие по calendarId:eventId", () => {
    const store = new CalendarEventStore();
    store.applyBatch({
      enabledCalendarIds: ["a"],
      results: [{ calendarId: "a", ok: true, fetchedAt: 1, events: [ev("a", "u1", "2026-01-10T10:00:00")] }],
    });

    const found = store.getByEventKey("a:u1");
    expect(found?.id).toBe("u1");
    expect(store.getByEventKey("  a:u1  ")?.id).toBe("u1");
    expect(store.getByEventKey("")).toBeNull();
  });

  it("exportLastGoodSnapshot без фильтра возвращает все lastGood календари", () => {
    const store = new CalendarEventStore();
    store.applyBatch({
      enabledCalendarIds: ["a", "b"],
      results: [
        { calendarId: "a", ok: true, fetchedAt: 1, events: [ev("a", "1", "2026-01-01T10:00:00.000Z")] },
        { calendarId: "b", ok: true, fetchedAt: 2, events: [] },
      ],
    });

    const snap = store.exportLastGoodSnapshot();
    expect(Object.keys(snap).sort()).toEqual(["a", "b"]);
  });

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
    expect(events.map((e) => e.calendar.id)).toEqual(["a", "b"]);
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
    expect(store.getEvents().every((e) => e.calendar.id === "a")).toBe(true);
  });

  it("applyBatch игнорирует результаты для отключённых календарей", () => {
    const store = new CalendarEventStore();
    store.applyBatch({
      enabledCalendarIds: ["a"],
      results: [
        { calendarId: "a", ok: true, fetchedAt: 1, events: [ev("a", "1", "2026-01-01T10:00:00.000Z")] },
        { calendarId: "b", ok: true, fetchedAt: 2, events: [ev("b", "1", "2026-01-02T10:00:00.000Z")] }, // disabled
      ],
    });

    expect(store.getEvents().map((e) => e.calendar.id)).toEqual(["a"]);
    expect(store.getPerCalendarStatus()["b"]).toBeUndefined();
  });

  it("seedFromCache не добавляет события, если lastGood для календаря пустой", () => {
    const store = new CalendarEventStore();
    store.seedFromCache({
      enabledCalendarIds: ["a"],
      lastGood: { a: { fetchedAt: 10, events: [] } },
    });
    expect(store.getEvents()).toEqual([]);
    expect(store.getPerCalendarStatus()["a"]).toMatchObject({ status: "stale", fetchedAt: 10 });
  });

  it("getRefreshResult возвращает копии структур (не отдаёт внутренние ссылки)", () => {
    const store = new CalendarEventStore();
    store.applyBatch({
      enabledCalendarIds: ["a"],
      results: [{ calendarId: "a", ok: true, fetchedAt: 1, events: [ev("a", "1", "2026-01-01T10:00:00.000Z")] }],
    });

    const r1 = store.getRefreshResult();
    r1.events.push(ev("a", "x", "2026-01-02T10:00:00.000Z"));
    (r1.perCalendar as any)["b"] = { status: "fresh", fetchedAt: 1 };

    const r2 = store.getRefreshResult();
    expect(r2.events).toHaveLength(1);
    expect(r2.perCalendar["b"]).toBeUndefined();
  });
});
