import type { AssistantSettings, CalendarConfig, CalendarEvent } from "../types";
import { IcsUrlProvider } from "./providers/icsUrlProvider";
import { CaldavProvider } from "./providers/caldavProvider";
import { CalendarEventStore } from "./store/calendarEventStore";

type Listener = () => void;

/**
 * Ошибка обновления конкретного календаря.
 *
 * Используется в UI/логах для показа причины, почему данные не обновились.
 */
export interface CalendarRefreshError {
  calendarId: string;
  name: string;
  error: string;
}

/**
 * Сервис календарей: обновляет события из источников (ICS/CalDAV),
 * хранит текущее состояние в `CalendarEventStore` и уведомляет подписчиков об изменениях.
 */
export class CalendarService {
  private settings: AssistantSettings;
  private store = new CalendarEventStore();
  private listeners = new Set<Listener>();
  private icsUrlProvider: IcsUrlProvider;
  private caldavProvider: CaldavProvider;

  constructor(settings: AssistantSettings) {
    this.settings = settings;
    this.icsUrlProvider = new IcsUrlProvider(settings);
    this.caldavProvider = new CaldavProvider(settings);
  }

  /** Применить новые настройки без пересоздания сервиса. */
  setSettings(settings: AssistantSettings) {
    this.settings = settings;
    this.icsUrlProvider.setSettings(settings);
    this.caldavProvider.setSettings(settings);
  }

  /** Подписка на изменения событий/статуса (после refresh). */
  onChange(cb: Listener) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Текущий “снимок” событий (включая кэш/статус stale при проблемах сети). */
  getEvents(): CalendarEvent[] {
    return this.store.getEvents();
  }

  /** Статус данных по календарям (fresh/stale + время/ошибка). */
  getPerCalendarStatus() {
    return this.store.getPerCalendarStatus();
  }

  /**
   * Инициализировать in-memory стор данными из persistent cache (после рестарта).
   *
   * Семантика: кэш считается “stale”, пока не будет успешного refresh.
   */
  seedFromCache(params: { enabledCalendarIds: string[]; lastGood: Record<string, { fetchedAt: number; events: CalendarEvent[] }> }): void {
    this.store.seedFromCache({
      enabledCalendarIds: params.enabledCalendarIds,
      lastGood: params.lastGood,
    });
    this.emit();
  }

  /** Экспортировать lastGood данные для persistent cache. */
  exportLastGoodForCache(params: { enabledCalendarIds: string[] }): Record<string, { fetchedAt: number; events: CalendarEvent[] }> {
    return this.store.exportLastGoodSnapshot({ enabledCalendarIds: params.enabledCalendarIds });
  }

  /**
   * Обновить один календарь и аккуратно смержить результат с остальными (чтобы не терять кэш по другим календарям).
   */
  async refreshOneAndMerge(calendarId: string): Promise<{ events: CalendarEvent[]; errors: CalendarRefreshError[] }> {
    const cal = this.settings.calendars.find((c) => c.id === calendarId);
    if (!cal) {
      return {
        events: this.getEvents(),
        errors: [{ calendarId, name: "", error: "Календарь не найден" }],
      };
    }
    if (!cal.enabled) {
      // Семантика: выключенные календари не должны “вмешиваться” в данные.
      return {
        events: this.getEvents(),
        errors: [{ calendarId: cal.id, name: cal.name, error: "Календарь отключён" }],
      };
    }

    try {
      const newEvents = await this.refreshOneCalendar(cal);
      // Обновляем стор результатом по одному календарю; остальные оставляют lastGood данные.
      this.store.applyBatch({
        enabledCalendarIds: this.settings.calendars.filter((c) => c.enabled).map((c) => c.id),
        results: [{ calendarId: cal.id, ok: true, fetchedAt: Date.now(), events: newEvents }],
      });
      this.emit();
      return { events: this.getEvents(), errors: [] };
    } catch (e) {
      return {
        events: this.getEvents(),
        errors: [{ calendarId: cal.id, name: cal.name, error: String((e as unknown) ?? "неизвестная ошибка") }],
      };
    }
  }

  /**
   * Обновить все включённые календари.
   * При ошибках не “обнуляет” данные: стор переводит календарь в stale и оставляет lastGood (если был).
   */
  async refreshAll(): Promise<{ events: CalendarEvent[]; errors: CalendarRefreshError[] }> {
    const enabled = this.settings.calendars.filter((c) => c.enabled);
    const errors: CalendarRefreshError[] = [];

    const results = await Promise.allSettled(
      enabled.map(async (cal) => {
        return await this.refreshOneCalendar(cal);
      }),
    );

    const fetchedAt = Date.now();
    const batchResults: Array<
      { calendarId: string; ok: true; fetchedAt: number; events: CalendarEvent[] } | { calendarId: string; ok: false; error: string }
    > = [];

    for (let i = 0; i < results.length; i++) {
      const cal = enabled[i];
      const r = results[i];
      if (r.status === "fulfilled") {
        batchResults.push({ calendarId: cal.id, ok: true, fetchedAt, events: r.value });
      } else {
        const err = String((r.reason as unknown) ?? "неизвестная ошибка");
        batchResults.push({ calendarId: cal.id, ok: false, error: err });
        errors.push({
          calendarId: cal.id,
          name: cal.name,
          error: err,
        });
      }
    }

    // Стор смержит lastGood по календарям; упавшие календари станут stale и сохранят lastGood (если он был).
    this.store.applyBatch({
      enabledCalendarIds: enabled.map((c) => c.id),
      results: batchResults,
    });
    this.emit();
    return { events: this.getEvents(), errors };
  }

  private async refreshOneCalendar(cal: CalendarConfig): Promise<CalendarEvent[]> {
    if (cal.type === "ics_url") return await this.icsUrlProvider.refresh(cal);
    if (cal.type === "caldav") return await this.caldavProvider.refresh(cal);
    return [];
  }

  private emit() {
    for (const cb of this.listeners) cb();
  }
}
