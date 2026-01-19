import type { CalendarEvent, CalendarId } from "../../types";

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
  events: CalendarEvent[];
  /** Статусы по календарям (fresh/stale). */
  perCalendar: Record<CalendarId, CalendarDataStatus>;
}

type LastGood = { fetchedAt: number; events: CalendarEvent[] };

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
  private mergedEvents: CalendarEvent[] = [];
  private updatedAt = 0;

  /**
   * Экспортировать lastGood snapshot для persistent cache.
   *
   * Важно: это “сырой” снимок событий (с Date внутри) — сериализацией занимается отдельный слой (CalendarEventCache).
   */
  exportLastGoodSnapshot(params?: {
    enabledCalendarIds?: CalendarId[];
  }): Record<CalendarId, { fetchedAt: number; events: CalendarEvent[] }> {
    const enabled = params?.enabledCalendarIds ? new Set(params.enabledCalendarIds) : null;
    const out: Record<CalendarId, { fetchedAt: number; events: CalendarEvent[] }> = {};
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
    lastGood: Record<CalendarId, { fetchedAt: number; events: CalendarEvent[] }>;
  }): void {
    this.lastGoodByCalendarId.clear();
    this.perCalendar = {};

    for (const [calendarId, v] of Object.entries(params.lastGood ?? {})) {
      this.lastGoodByCalendarId.set(calendarId, { fetchedAt: v.fetchedAt, events: (v.events ?? []).slice() });
      this.perCalendar[calendarId] = { status: "stale", fetchedAt: v.fetchedAt };
    }

    const all: CalendarEvent[] = [];
    for (const id of params.enabledCalendarIds) {
      const last = this.lastGoodByCalendarId.get(id);
      if (last?.events?.length) all.push(...last.events);
      if (!this.perCalendar[id] && last?.fetchedAt) this.perCalendar[id] = { status: "stale", fetchedAt: last.fetchedAt };
    }
    all.sort((a, b) => a.start.getTime() - b.start.getTime());

    this.mergedEvents = all;
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
  getEvents(): CalendarEvent[] {
    return this.mergedEvents.slice();
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
      | { calendarId: CalendarId; ok: true; fetchedAt: number; events: CalendarEvent[] }
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
    const all: CalendarEvent[] = [];
    for (const id of params.enabledCalendarIds) {
      const last = this.lastGoodByCalendarId.get(id);
      if (last?.events?.length) all.push(...last.events);
    }
    all.sort((a, b) => a.start.getTime() - b.start.getTime());

    this.mergedEvents = all;
    this.updatedAt = Date.now();
  }
}
