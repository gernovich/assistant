import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { CalendarEventCache } from "../src/calendar/store/calendarEventCache";

function cal(id: string) {
  return { id, name: id, type: "ics_url", config: { id, name: id, type: "ics_url", enabled: true } } as any;
}

describe("CalendarEventCache decodeSnapshot branches", () => {
  it("loadIntoCalendarService: фильтрует remindersMinutesBefore в числа и строит reminders[]", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "assistant-cache-"));
    const filePath = path.join(dir, "cache.json");

    // V3 snapshot с напоминаниями, в которых есть мусор (нечисла)
    const snap = {
      version: 3,
      savedAtMs: Date.now(),
      calendars: {
        cal1: {
          fetchedAtMs: Date.now(),
          events: [
            {
              version: 3,
              calendarId: "cal1",
              id: "e1",
              summary: "S",
              startMs: Date.now(),
              remindersMinutesBefore: ["5", "x", 10, null],
            },
          ],
        },
      },
    };
    await fs.writeFile(filePath, JSON.stringify(snap), "utf8");

    const cache = new CalendarEventCache({ filePath, logService: () => ({ info: vi.fn(), warn: vi.fn() }) });

    const seedFromCache = vi.fn();
    const calendarService = { seedFromCache } as any;
    await cache.loadIntoCalendarService(calendarService, { enabledCalendarIds: ["cal1"] as any });

    expect(seedFromCache).toHaveBeenCalledTimes(1);
    const arg = seedFromCache.mock.calls[0]![0];
    const ev = arg.lastGood.cal1.events[0];

    // Важно: remindersMinutesBefore -> reminders[] и фильтрация мусора
    expect(ev.reminders).toHaveLength(2);
    expect(ev.reminders[0].minutesBefore).toBe(5);
    expect(ev.reminders[1].minutesBefore).toBe(10);
    expect(ev.calendar.id).toBe("cal1");
  });
});

