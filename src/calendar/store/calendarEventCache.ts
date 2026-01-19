import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CalendarEvent, CalendarId } from "../../types";
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
  myPartstat?: CalendarEvent["myPartstat"];
};

type CalendarCacheSnapshotV1 = {
  version: 1;
  savedAtMs: number;
  calendars: Record<CalendarId, { fetchedAtMs: number; events: CachedEventV1[] }>;
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
  async saveFromCalendarService(calendarService: CalendarService, params: { enabledCalendarIds: CalendarId[] }): Promise<void> {
    const lastGood = calendarService.exportLastGoodForCache({ enabledCalendarIds: params.enabledCalendarIds });
    const snap = encodeSnapshot(lastGood);
    await this.save(snap);
  }

  private async load(): Promise<CalendarCacheSnapshotV1 | null> {
    if (!this.filePath) return null;
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as CalendarCacheSnapshotV1;
      if (!parsed || parsed.version !== 1 || typeof parsed.savedAtMs !== "number") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async save(snapshot: CalendarCacheSnapshotV1): Promise<void> {
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

function encodeSnapshot(lastGood: Record<CalendarId, { fetchedAt: number; events: CalendarEvent[] }>): CalendarCacheSnapshotV1 {
  const calendars: CalendarCacheSnapshotV1["calendars"] = {};
  for (const [calendarId, v] of Object.entries(lastGood)) {
    calendars[calendarId] = {
      fetchedAtMs: v.fetchedAt,
      events: v.events.map((ev) => ({
        calendarId: ev.calendarId,
        uid: ev.uid,
        summary: ev.summary,
        description: ev.description,
        location: ev.location,
        startMs: ev.start.getTime(),
        endMs: ev.end ? ev.end.getTime() : undefined,
        allDay: ev.allDay,
        myPartstat: ev.myPartstat,
      })),
    };
  }
  return { version: 1, savedAtMs: Date.now(), calendars };
}

function decodeSnapshot(snap: CalendarCacheSnapshotV1): Record<CalendarId, { fetchedAt: number; events: CalendarEvent[] }> {
  const out: Record<CalendarId, { fetchedAt: number; events: CalendarEvent[] }> = {};
  for (const [calendarId, v] of Object.entries(snap.calendars ?? {})) {
    const fetchedAt = Number(v?.fetchedAtMs);
    const events = Array.isArray(v?.events) ? v.events : [];
    out[calendarId] = {
      fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : 0,
      events: events
        .map((e): CalendarEvent | null => {
          const start = new Date(Number(e?.startMs));
          if (Number.isNaN(start.getTime())) return null;
          const endMs = e?.endMs;
          const end = typeof endMs === "number" && Number.isFinite(endMs) ? new Date(endMs) : undefined;
          return {
            calendarId,
            uid: String(e?.uid ?? ""),
            summary: String(e?.summary ?? ""),
            description: e?.description ? String(e.description) : undefined,
            location: e?.location ? String(e.location) : undefined,
            start,
            end,
            allDay: e?.allDay === true,
            myPartstat: e?.myPartstat,
          };
        })
        .filter((x): x is CalendarEvent => Boolean(x)),
    };
  }
  return out;
}
