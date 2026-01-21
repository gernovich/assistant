import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CalendarEventCache } from "../src/calendar/store/calendarEventCache";

describe("calendar/store/calendarEventCache", () => {
  it("saveFromCalendarService пишет snapshot на диск без url и loadIntoCalendarService seed-ит CalendarService", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "assistant-calendar-cache-"));
    const cachePath = path.join(tmp, "calendar-cache.json");

    const cache = new CalendarEventCache({ filePath: cachePath });

    const lastGood = {
      calA: {
        fetchedAt: 123,
        events: [
          {
            calendar: { id: "calA", name: "calA", type: "ics_url", config: { id: "calA", name: "calA", type: "ics_url", enabled: true } },
            id: "uid-1",
            summary: "Событие 1",
            url: "https://secret.example.com/?token=abc", // не должно попадать в кэш
            start: new Date("2026-01-01T10:00:00.000Z"),
            end: new Date("2026-01-01T11:00:00.000Z"),
            status: "accepted" as const,
          },
        ],
      },
    };

    const exportLastGoodForCache = vi.fn(() => lastGood);
    await cache.saveFromCalendarService({ exportLastGoodForCache } as any, { enabledCalendarIds: ["calA"], maxEventsPerCalendar: 2000 });

    const raw = await fs.readFile(cachePath, "utf8");
    expect(raw).toContain('"version":3');
    expect(raw).toContain('"calA"');
    expect(raw).not.toContain("secret.example.com");
    expect(raw).not.toContain('"url"');

    const seedFromCache = vi.fn();
    await cache.loadIntoCalendarService({ seedFromCache } as any, { enabledCalendarIds: ["calA"] });
    expect(seedFromCache).toHaveBeenCalledTimes(1);

    const call = seedFromCache.mock.calls[0]?.[0] as any;
    expect(call.enabledCalendarIds).toEqual(["calA"]);
    expect(call.lastGood.calA.fetchedAt).toBe(123);
    expect(call.lastGood.calA.events[0].summary).toBe("Событие 1");
    expect(call.lastGood.calA.events[0].start).toBeInstanceOf(Date);

    vi.useRealTimers();
  });

  it("saveFromCalendarService применяет лимит maxEventsPerCalendar (обрезает events на календарь)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "assistant-calendar-cache-"));
    const cachePath = path.join(tmp, "calendar-cache.json");
    const cache = new CalendarEventCache({ filePath: cachePath });

    const lastGood = {
      calA: {
        fetchedAt: 1,
        events: [
          { calendar: { id: "calA", name: "calA", type: "ics_url", config: { id: "calA", name: "calA", type: "ics_url", enabled: true } }, id: "1", summary: "1", start: new Date(1) },
          { calendar: { id: "calA", name: "calA", type: "ics_url", config: { id: "calA", name: "calA", type: "ics_url", enabled: true } }, id: "2", summary: "2", start: new Date(2) },
          { calendar: { id: "calA", name: "calA", type: "ics_url", config: { id: "calA", name: "calA", type: "ics_url", enabled: true } }, id: "3", summary: "3", start: new Date(3) },
        ],
      },
    };
    const exportLastGoodForCache = vi.fn(() => lastGood);
    await cache.saveFromCalendarService({ exportLastGoodForCache } as any, { enabledCalendarIds: ["calA"], maxEventsPerCalendar: 2 });

    const raw = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as any;
    expect(parsed.calendars.calA.events.map((e: any) => e.id)).toEqual(["1", "2"]);
  });

  it("loadIntoCalendarService фильтрует события с невалидным startMs", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "assistant-calendar-cache-"));
    const cachePath = path.join(tmp, "calendar-cache.json");

    // Сохраняем snapshot вручную, чтобы проверить фильтрацию на decode.
    const snap = {
      version: 1,
      savedAtMs: Date.now(),
      calendars: {
        calA: {
          fetchedAtMs: 1,
          events: [
            { calendarId: "calA", uid: "ok", summary: "ok", startMs: 1 },
            { calendarId: "calA", uid: "bad", summary: "bad", startMs: "NaN" },
          ],
        },
      },
    };
    await fs.writeFile(cachePath, JSON.stringify(snap), "utf8");

    const seedFromCache = vi.fn();
    const cache = new CalendarEventCache({ filePath: cachePath });
    await cache.loadIntoCalendarService({ seedFromCache } as any, { enabledCalendarIds: ["calA"] });

    const call = seedFromCache.mock.calls[0]?.[0] as any;
    expect(call.lastGood.calA.events.map((e: any) => e.id)).toEqual(["ok"]);
  });

  it("loadIntoCalendarService не вызывает seedFromCache, если кэш отсутствует/не читается", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "assistant-calendar-cache-"));
    const cachePath = path.join(tmp, "missing.json"); // файла нет
    const seedFromCache = vi.fn();
    const cache = new CalendarEventCache({ filePath: cachePath });
    await cache.loadIntoCalendarService({ seedFromCache } as any, { enabledCalendarIds: ["calA"] });
    expect(seedFromCache).toHaveBeenCalledTimes(0);
  });

  it("loadIntoCalendarService не вызывает seedFromCache, если snapshot невалидный (version/savedAtMs)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "assistant-calendar-cache-"));
    const cachePath = path.join(tmp, "calendar-cache.json");
    await fs.writeFile(cachePath, JSON.stringify({ version: 4, savedAtMs: "x", calendars: {} }), "utf8");

    const seedFromCache = vi.fn();
    const cache = new CalendarEventCache({ filePath: cachePath });
    await cache.loadIntoCalendarService({ seedFromCache } as any, { enabledCalendarIds: ["calA"] });
    expect(seedFromCache).toHaveBeenCalledTimes(0);
  });

  it("loadIntoCalendarService: декодирует v2 поля (timeZone/rrule/eventColor/endMs/fetchedAt fallback)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "assistant-calendar-cache-"));
    const cachePath = path.join(tmp, "calendar-cache.json");

    const snap = {
      version: 2,
      savedAtMs: Date.now(),
      calendars: {
        calA: {
          fetchedAtMs: "bad",
          events: [
            {
              version: 2,
              calendarId: "calA",
              uid: "u1",
              summary: "S",
              startMs: Date.UTC(2026, 0, 1, 10, 0, 0),
              endMs: "bad",
              timeZone: "Europe/Moscow",
              rrule: "FREQ=DAILY;COUNT=3",
              remindersMinutesBefore: [null, "", "15", "x", 0],
              eventColor: "#ff0000",
            },
          ],
        },
      },
    };
    await fs.writeFile(cachePath, JSON.stringify(snap), "utf8");

    const seedFromCache = vi.fn();
    const cache = new CalendarEventCache({ filePath: cachePath });
    await cache.loadIntoCalendarService({ seedFromCache } as any, { enabledCalendarIds: ["calA"] });

    const arg = seedFromCache.mock.calls[0]?.[0] as any;
    expect(arg.lastGood.calA.fetchedAt).toBe(0); // fallback
    const ev = arg.lastGood.calA.events[0];
    expect(ev.id).toBe("u1");
    expect(ev.timeZone).toBe("Europe/Moscow");
    expect(ev.recurrence?.rrule).toBe("FREQ=DAILY;COUNT=3");
    expect(ev.color?.value).toBe("#ff0000");
    expect(ev.end).toBeUndefined();
    expect(ev.reminders?.map((r: any) => r.minutesBefore)).toEqual([15, 0]);
  });

  it("loadIntoCalendarService: фильтрует события без id и корректно выставляет optional поля (end/reminders/color)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "assistant-calendar-cache-"));
    const cachePath = path.join(tmp, "calendar-cache.json");

    const snap = {
      version: 3,
      savedAtMs: Date.now(),
      calendars: {
        calA: {
          fetchedAtMs: 10,
          events: [
            // будет отфильтровано (id пустой)
            { version: 3, calendarId: "calA", id: "", summary: "bad", startMs: Date.UTC(2026, 0, 1, 10, 0, 0) },
            // валидное
            { version: 3, calendarId: "calA", id: "ok", summary: "ok", startMs: Date.UTC(2026, 0, 1, 10, 0, 0), endMs: Date.UTC(2026, 0, 1, 11, 0, 0), allDay: true },
          ],
        },
      },
    };
    await fs.writeFile(cachePath, JSON.stringify(snap), "utf8");

    const seedFromCache = vi.fn();
    const cache = new CalendarEventCache({ filePath: cachePath });
    await cache.loadIntoCalendarService({ seedFromCache } as any, { enabledCalendarIds: ["calA"] });

    const arg = seedFromCache.mock.calls[0]?.[0] as any;
    expect(arg.lastGood.calA.fetchedAt).toBe(10);
    expect(arg.lastGood.calA.events).toHaveLength(1);
    const ev = arg.lastGood.calA.events[0];
    expect(ev.id).toBe("ok");
    expect(ev.allDay).toBe(true);
    expect(ev.end).toBeInstanceOf(Date);
    expect(ev.reminders).toBeUndefined();
    expect(ev.color).toBeUndefined();
  });

  it("saveFromCalendarService: если maxEventsPerCalendar <= 0, не режет список событий", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "assistant-calendar-cache-"));
    const cachePath = path.join(tmp, "calendar-cache.json");
    const cache = new CalendarEventCache({ filePath: cachePath });

    const lastGood = {
      calA: {
        fetchedAt: 1,
        events: [
          { calendar: { id: "calA", name: "calA", type: "ics_url", config: { id: "calA", name: "calA", type: "ics_url", enabled: true } }, id: "1", summary: "1", start: new Date(1) },
          { calendar: { id: "calA", name: "calA", type: "ics_url", config: { id: "calA", name: "calA", type: "ics_url", enabled: true } }, id: "2", summary: "2", start: new Date(2) },
        ],
      },
    };
    const exportLastGoodForCache = vi.fn(() => lastGood);
    await cache.saveFromCalendarService({ exportLastGoodForCache } as any, { enabledCalendarIds: ["calA"], maxEventsPerCalendar: 0 });

    const raw = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as any;
    expect(parsed.calendars.calA.events.map((e: any) => e.id)).toEqual(["1", "2"]);
  });

  it("saveFromCalendarService не кидает ошибку и пишет warn, если файл нельзя сохранить", async () => {
    const warns: Array<{ m: string; data?: Record<string, unknown> }> = [];
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "assistant-calendar-cache-"));
    const blocker = path.join(tmp, "not-a-dir");
    await fs.writeFile(blocker, "x", "utf8"); // файл, не директория
    const cache = new CalendarEventCache({
      filePath: path.join(blocker, "calendar-cache.json"),
      logService: () => ({
        info: () => undefined,
        warn: (m, data) => warns.push({ m, data }),
      }),
    });
    const exportLastGoodForCache = vi.fn(() => ({
      calA: { fetchedAt: 1, events: [{ calendar: { id: "calA", name: "calA", type: "ics_url", config: { id: "calA", name: "calA", type: "ics_url", enabled: true } }, id: "u", summary: "s", start: new Date(1) }] },
    }));
    await cache.saveFromCalendarService({ exportLastGoodForCache } as any, { enabledCalendarIds: ["calA"], maxEventsPerCalendar: 2000 });
    expect(warns.some((w) => w.m.includes("не удалось сохранить persistent cache"))).toBe(true);
  });
});
