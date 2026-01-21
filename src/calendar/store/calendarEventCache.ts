import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Calendar, CalendarConfig, CalendarId, Event, Person, ReminderStatus } from "../../types";
import type { CalendarService } from "../calendarService";
import { redactSecretsInStringForLog } from "../../log/redact";

type CachedEventV1 = {
  calendarId: CalendarId;
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  startMs: number;
  endMs?: number;
  allDay?: boolean;
  myPartstat?: Event["status"];
};

type CachedEventV2 = CachedEventV1 & {
  version: 2;
  timeZone?: string;
  rrule?: string;
  remindersMinutesBefore?: number[];
  eventColor?: string;
};

type CachedEventV3 = Omit<CachedEventV2, "uid" | "version"> & {
  version: 3;
  id: string;
};

type CalendarCacheSnapshotV1 = {
  version: 1;
  savedAtMs: number;
  calendars: Record<CalendarId, { fetchedAtMs: number; events: CachedEventV1[] }>;
};

type CalendarCacheSnapshotV2 = {
  version: 2;
  savedAtMs: number;
  calendars: Record<CalendarId, { fetchedAtMs: number; events: CachedEventV2[] }>;
};

type CalendarCacheSnapshotV3 = {
  version: 3;
  savedAtMs: number;
  calendars: Record<CalendarId, { fetchedAtMs: number; events: CachedEventV3[] }>;
};

/**
 * Persistent cache событий календаря (на диск), чтобы после рестарта Obsidian повестка
 * могла показывать last-good данные даже без сети.
 *
 * Важно: чтобы не хранить/не разносить секреты, кэш НЕ сохраняет `url` события.
 */
export class CalendarEventCache {
  private filePath: string;
  private getLogService?: () => {
    info: (m: string, data?: Record<string, unknown>) => void;
    warn: (m: string, data?: Record<string, unknown>) => void;
  };

  constructor(params: {
    filePath: string;
    logService?: () => {
      info: (m: string, data?: Record<string, unknown>) => void;
      warn: (m: string, data?: Record<string, unknown>) => void;
    };
  }) {
    this.filePath = params.filePath;
    this.getLogService = params.logService;
  }

  /** Загрузить кэш и передать его в `CalendarService` (как seed lastGood). */
  async loadIntoCalendarService(calendarService: CalendarService, params: { enabledCalendarIds: CalendarId[] }): Promise<void> {
    const snap = await this.load();
    if (!snap) return;
    const lastGood = decodeSnapshot(snap);
    calendarService.seedFromCache({ enabledCalendarIds: params.enabledCalendarIds, lastGood });
    this.getLogService?.().info("Календарь: загружен persistent cache (после рестарта)", { calendars: Object.keys(lastGood).length });
  }

  /** Сохранить snapshot из `CalendarService` на диск. */
  async saveFromCalendarService(
    calendarService: CalendarService,
    params: { enabledCalendarIds: CalendarId[]; maxEventsPerCalendar?: number },
  ): Promise<void> {
    const lastGood = calendarService.exportLastGoodForCache({ enabledCalendarIds: params.enabledCalendarIds });
    const limited = limitLastGoodEvents(lastGood, params.maxEventsPerCalendar);
    const snap = encodeSnapshot(limited);
    await this.save(snap);
  }

  private async load(): Promise<CalendarCacheSnapshotV1 | CalendarCacheSnapshotV2 | CalendarCacheSnapshotV3 | null> {
    if (!this.filePath) return null;
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as CalendarCacheSnapshotV1 | CalendarCacheSnapshotV2 | CalendarCacheSnapshotV3;
      if (!parsed || (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3) || typeof parsed.savedAtMs !== "number") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async save(snapshot: CalendarCacheSnapshotV1 | CalendarCacheSnapshotV2 | CalendarCacheSnapshotV3): Promise<void> {
    if (!this.filePath) return;
    try {
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(snapshot), "utf8");
    } catch (e) {
      const msg = redactSecretsInStringForLog(String((e as unknown) ?? "неизвестная ошибка"));
      this.getLogService?.().warn("Календарь: не удалось сохранить persistent cache", { error: msg });
    }
  }
}

function limitLastGoodEvents(
  lastGood: Record<CalendarId, { fetchedAt: number; events: Event[] }>,
  maxEventsPerCalendar: number | undefined,
): Record<CalendarId, { fetchedAt: number; events: Event[] }> {
  const max = typeof maxEventsPerCalendar === "number" ? maxEventsPerCalendar : Number(maxEventsPerCalendar);
  if (!Number.isFinite(max) || max <= 0) return lastGood;

  const out: Record<CalendarId, { fetchedAt: number; events: Event[] }> = {};
  for (const [calendarId, v] of Object.entries(lastGood)) {
    out[calendarId] = {
      fetchedAt: v.fetchedAt,
      events: (v.events ?? []).slice(0, Math.floor(max)),
    };
  }
  return out;
}

function encodeSnapshot(lastGood: Record<CalendarId, { fetchedAt: number; events: Event[] }>): CalendarCacheSnapshotV3 {
  const calendars: CalendarCacheSnapshotV3["calendars"] = {};
  for (const [calendarId, v] of Object.entries(lastGood)) {
    calendars[calendarId] = {
      fetchedAtMs: v.fetchedAt,
      events: v.events.map((ev) => ({
        version: 3,
        calendarId: ev.calendar.id,
        id: ev.id,
        summary: ev.summary,
        description: ev.description,
        location: ev.location,
        startMs: ev.start.getTime(),
        endMs: ev.end ? ev.end.getTime() : undefined,
        allDay: ev.allDay,
        myPartstat: ev.status,
        timeZone: ev.timeZone,
        rrule: ev.recurrence?.rrule,
        remindersMinutesBefore: ev.reminders?.map((r) => r.minutesBefore).filter((n): n is number => typeof n === "number" && Number.isFinite(n)),
        eventColor: ev.color?.value,
      })),
    };
  }
  return { version: 3, savedAtMs: Date.now(), calendars };
}

function decodeSnapshot(snap: CalendarCacheSnapshotV1 | CalendarCacheSnapshotV2 | CalendarCacheSnapshotV3): Record<CalendarId, { fetchedAt: number; events: Event[] }> {
  const out: Record<CalendarId, { fetchedAt: number; events: Event[] }> = {};
  for (const [calendarId, v] of Object.entries(snap.calendars ?? {})) {
    const fetchedAt = Number(v?.fetchedAtMs);
    const events = Array.isArray(v?.events) ? (v.events as Array<CachedEventV1 | CachedEventV2 | CachedEventV3>) : [];
    out[calendarId] = {
      fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : 0,
      events: events
        .map((e: CachedEventV1 | CachedEventV2 | CachedEventV3): Event | null => {
          const start = new Date(Number(e?.startMs));
          if (Number.isNaN(start.getTime())) return null;
          const endMs = e?.endMs;
          const end = typeof endMs === "number" && Number.isFinite(endMs) ? new Date(endMs) : undefined;
          const timeZone = "timeZone" in e && e.timeZone ? String(e.timeZone) : undefined;
          const rrule = "rrule" in e && e.rrule ? String(e.rrule) : undefined;
          const remindersMinutesBefore = Array.isArray((e as any)?.remindersMinutesBefore)
            ? ((e as any).remindersMinutesBefore as unknown[])
                .map((x: unknown) => (x == null || x === "" ? Number.NaN : Number(x)))
                .filter((n: number) => Number.isFinite(n))
            : [];
          const eventColor = "eventColor" in e && e.eventColor ? String(e.eventColor) : undefined;
          const id = "id" in e && e.id ? String(e.id) : "uid" in e && (e as any).uid ? String((e as any).uid) : "";
          if (!id) return null;
          const calendar: Calendar = { id: calendarId, name: "", type: "ics_url", config: ({ id: calendarId, name: "", type: "ics_url", enabled: true } as unknown) as CalendarConfig };
          const reminderPerson: Person = {};
          const reminderStatus: ReminderStatus = "planned";
          return {
            calendar,
            id,
            summary: String(e?.summary ?? ""),
            description: e?.description ? String(e.description) : undefined,
            location: e?.location ? String(e.location) : undefined,
            start,
            end,
            allDay: e?.allDay === true,
            status: e?.myPartstat,
            timeZone,
            recurrence: rrule ? { rrule } : undefined,
            reminders: remindersMinutesBefore.length
              ? remindersMinutesBefore.map((m: number) => ({ minutesBefore: m, status: reminderStatus, person: reminderPerson }))
              : undefined,
            color: eventColor ? { value: eventColor } : undefined,
          };
        })
        .filter((x): x is Event => Boolean(x)),
    };
  }
  return out;
}
