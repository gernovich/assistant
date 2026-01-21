import type { CalendarId, Event } from "../../types";
import { makeEventKey } from "../../ids/stableIds";

/**
 * Статус данных конкретного календаря после refresh:
 * - `fresh`: обновилось успешно
 * - `stale`: обновить не удалось, показываем lastGood (если есть)
 */
export type CalendarDataStatus = { status: "fresh"; fetchedAt: number } | { status: "stale"; fetchedAt?: number; error?: string };

/** Результат refresh для UI/синхронизации (offline-first: events могут быть lastGood). */
export interface RefreshResult {
  /** Время последнего пересчёта стора (Unix time, мс). */
  updatedAt: number;
  /** Текущий слитый список событий (может включать lastGood). */
  events: Event[];
  /** Статусы по календарям (fresh/stale). */
  perCalendar: Record<CalendarId, CalendarDataStatus>;
}

type LastGood = { fetchedAt: number; events: Event[] };

/**
 * In-memory стор событий с “offline-first” поведением:
 * - хранит lastGood данные по `calendarId`
 * - помечает календари как stale при ошибках refresh
 * - отдаёт слитый и отсортированный список событий
 *
 * Примечание: персистентный кэш на диск — отдельный шаг (CalendarEventCache).
 */
export class CalendarEventStore {
  private lastGoodByCalendarId = new Map<CalendarId, LastGood>();
  private perCalendar: Record<CalendarId, CalendarDataStatus> = {};
  private mergedEvents: Event[] = [];
  private updatedAt = 0;

  /**
   * Индексы для быстрых выборок.
   *
   * Важно: это in-memory оптимизация. Источник истины — `mergedEvents` (отсортированный список).
   */
  private byCalendarId = new Map<CalendarId, Event[]>();
  private byDay = new Map<string, Event[]>();
  private byEventKey = new Map<string, Event>();

  /**
   * Экспортировать lastGood snapshot для persistent cache.
   *
   * Важно: это “сырой” снимок событий (с Date внутри) — сериализацией занимается отдельный слой (CalendarEventCache).
   */
  exportLastGoodSnapshot(params?: {
    enabledCalendarIds?: CalendarId[];
  }): Record<CalendarId, { fetchedAt: number; events: Event[] }> {
    const enabled = params?.enabledCalendarIds ? new Set(params.enabledCalendarIds) : null;
    const out: Record<CalendarId, { fetchedAt: number; events: Event[] }> = {};
    for (const [calendarId, v] of this.lastGoodByCalendarId.entries()) {
      if (enabled && !enabled.has(calendarId)) continue;
      out[calendarId] = { fetchedAt: v.fetchedAt, events: v.events.slice() };
    }
    return out;
  }

  /**
   * Инициализировать стор из persistent cache (после рестарта).
   *
   * Семантика: данные из кэша считаем “stale”, пока не будет успешного refresh.
   */
  seedFromCache(params: {
    enabledCalendarIds: CalendarId[];
    lastGood: Record<CalendarId, { fetchedAt: number; events: Event[] }>;
  }): void {
    this.lastGoodByCalendarId.clear();
    this.perCalendar = {};

    for (const [calendarId, v] of Object.entries(params.lastGood ?? {})) {
      this.lastGoodByCalendarId.set(calendarId, { fetchedAt: v.fetchedAt, events: (v.events ?? []).slice() });
      this.perCalendar[calendarId] = { status: "stale", fetchedAt: v.fetchedAt };
    }

    const all: Event[] = [];
    for (const id of params.enabledCalendarIds) {
      const last = this.lastGoodByCalendarId.get(id);
      if (last?.events?.length) all.push(...last.events);
      if (!this.perCalendar[id] && last?.fetchedAt) this.perCalendar[id] = { status: "stale", fetchedAt: last.fetchedAt };
    }
    all.sort((a, b) => a.start.getTime() - b.start.getTime());

    this.mergedEvents = all;
    this.rebuildIndexes();
    this.updatedAt = Date.now();
  }

  /** Получить refresh-результат для UI (копии структур). */
  getRefreshResult(): RefreshResult {
    return {
      updatedAt: this.updatedAt,
      events: this.mergedEvents.slice(),
      perCalendar: { ...this.perCalendar },
    };
  }

  /** Получить текущий список событий (копия). */
  getEvents(): Event[] {
    return this.mergedEvents.slice();
  }

  /**
   * Получить события на конкретный день (локальное время).
   *
   * @param dayOffset 0 = сегодня, -1 = вчера, +1 = завтра
   * @param params.baseDate Базовая дата для расчёта “сегодня” (для тестов)
   */
  getDay(dayOffset: number, params?: { baseDate?: Date }): Event[] {
    const base = params?.baseDate ? new Date(params.baseDate.getTime()) : new Date();
    base.setHours(0, 0, 0, 0);
    base.setDate(base.getDate() + dayOffset);
    const key = ymdLocal(base);
    return (this.byDay.get(key) ?? []).slice();
  }

  /**
   * Получить события в диапазоне времени.
   *
   * Семантика: \(start <= ev.start < end\).
   */
  getRange(start: Date, end: Date): Event[] {
    const startMs = start.getTime();
    const endMs = end.getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

    // mergedEvents уже отсортирован по start.
    const i0 = lowerBoundByStart(this.mergedEvents, startMs);
    const out: Event[] = [];
    for (let i = i0; i < this.mergedEvents.length; i++) {
      const ev = this.mergedEvents[i];
      const t = ev.start.getTime();
      if (t >= endMs) break;
      out.push(ev);
    }
    return out;
  }

  /**
   * Получить ближайшие события в горизонте (по времени начала).
   *
   * @param horizonMs Горизонт вперёд от now
   * @param nowMs Текущее время (для тестов)
   */
  getUpcoming(horizonMs: number, nowMs: number = Date.now()): Event[] {
    const h = typeof horizonMs === "number" ? horizonMs : Number(horizonMs);
    if (!Number.isFinite(h) || h <= 0) return [];
    const from = new Date(nowMs - 60_000);
    const to = new Date(nowMs + h);
    return this.getRange(from, to);
  }

  /** Найти событие по стабильному ключу (`calendar_id:event_id`). */
  getByEventKey(eventKey: string): Event | null {
    const key = String(eventKey ?? "").trim();
    if (!key) return null;
    return this.byEventKey.get(key) ?? null;
  }

  /** Получить статусы по календарям (копия). */
  getPerCalendarStatus(): Record<CalendarId, CalendarDataStatus> {
    return { ...this.perCalendar };
  }

  /**
   * Применить результат batch-refresh:
   * - успешные календари обновляют lastGood и получают status=fresh
   * - упавшие календари получают status=stale и продолжают показывать lastGood (если есть)
   * - отключённые календари удаляются из status
   */
  applyBatch(params: {
    enabledCalendarIds: CalendarId[];
    results: Array<
      | { calendarId: CalendarId; ok: true; fetchedAt: number; events: Event[] }
      | { calendarId: CalendarId; ok: false; error: string }
    >;
  }) {
    const enabledSet = new Set(params.enabledCalendarIds);

    // Применяем обновления для календарей, которые обновлялись сейчас.
    for (const r of params.results) {
      if (!enabledSet.has(r.calendarId)) continue;
      if (r.ok) {
        this.lastGoodByCalendarId.set(r.calendarId, { fetchedAt: r.fetchedAt, events: r.events });
        this.perCalendar[r.calendarId] = { status: "fresh", fetchedAt: r.fetchedAt };
      } else {
        const last = this.lastGoodByCalendarId.get(r.calendarId);
        this.perCalendar[r.calendarId] = {
          status: "stale",
          fetchedAt: last?.fetchedAt,
          error: r.error,
        };
      }
    }

    // Удаляем статусы для отключённых/удалённых календарей.
    for (const id of Object.keys(this.perCalendar)) {
      if (!enabledSet.has(id)) delete this.perCalendar[id];
    }

    // Пересобираем слитый список событий из lastGood только для включённых календарей.
    const all: Event[] = [];
    for (const id of params.enabledCalendarIds) {
      const last = this.lastGoodByCalendarId.get(id);
      if (last?.events?.length) all.push(...last.events);
    }
    all.sort((a, b) => a.start.getTime() - b.start.getTime());

    this.mergedEvents = all;
    this.rebuildIndexes();
    this.updatedAt = Date.now();
  }

  private rebuildIndexes(): void {
    this.byCalendarId = new Map();
    this.byDay = new Map();
    this.byEventKey = new Map();

    for (const ev of this.mergedEvents) {
      // byCalendarId
      const byCal = this.byCalendarId.get(ev.calendar.id) ?? [];
      byCal.push(ev);
      this.byCalendarId.set(ev.calendar.id, byCal);

      // byDay (локальная дата)
      const dayKey = ymdLocal(ev.start);
      const byD = this.byDay.get(dayKey) ?? [];
      byD.push(ev);
      this.byDay.set(dayKey, byD);

      // byEventKey
      const ek = makeEventKey(ev.calendar.id, ev.id);
      this.byEventKey.set(ek, ev);
    }
  }
}

function ymdLocal(d: Date): string {
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function lowerBoundByStart(events: Event[], startMs: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const v = events[mid].start.getTime();
    if (v < startMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
