import type { AssistantSettings, CalendarConfig, Event } from "../types";
import { CalendarEventStore } from "./store/calendarEventStore";
import type { RefreshResult } from "./store/calendarEventStore";
import { MS_PER_HOUR, NOTIFICATIONS_HORIZON_HOURS } from "./constants";
import type { CalendarProviderRegistry } from "./providers/calendarProviderRegistry";
import { AppError, toAppErrorDto } from "../shared/appError";
import { APP_ERROR } from "../shared/appErrorCodes";
import { DEFAULT_CALENDAR_COLOR } from "../domain/policies/defaultCalendarColor";
import type { GoogleCalendarApi } from "../google/googleCalendarApi";
import { mergeGoogleEventColorLabels } from "../domain/policies/googleEventColorLabels";

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
  /** Сырой error для диагностики (stack/cause), в UI не показывается. */
  cause?: unknown;
}

/**
 * Сервис календарей: обновляет события из источников (ICS/CalDAV),
 * хранит текущее состояние в `CalendarEventStore` и уведомляет подписчиков об изменениях.
 */
export class CalendarService {
  private settings: AssistantSettings;
  private store = new CalendarEventStore();
  private listeners = new Set<Listener>();
  private googleLabelsByCalendarId = new Map<string, Array<{ id: string; name: string; color: string }>>();

  constructor(
    settings: AssistantSettings,
    private providers: CalendarProviderRegistry,
    private googleApi?: GoogleCalendarApi,
  ) {
    this.settings = settings;
  }

  /** Применить новые настройки без пересоздания сервиса. */
  setSettings(settings: AssistantSettings) {
    this.settings = settings;
    this.providers.setSettings(settings);
  }

  /** Подписка на изменения событий/статуса (после refresh). */
  onChange(cb: Listener) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Текущий “снимок” событий (включая кэш/статус stale при проблемах сети). */
  getEvents(): Event[] {
    return this.store.getEvents();
  }

  /** Единый контракт состояния (events + perCalendar + updatedAt). */
  getRefreshResult(): RefreshResult {
    return this.store.getRefreshResult();
  }

  /** События на день (локальное время). */
  getDayEvents(dayOffset: number, maxEvents: number): Event[] {
    const max = Math.max(1, Number(maxEvents) || 1);
    return this.store.getDay(dayOffset).slice(0, max);
  }

  /** События в диапазоне времени. */
  getRangeEvents(start: Date, end: Date): Event[] {
    return this.store.getRange(start, end);
  }

  /** Ближайшие события для планирования уведомлений (в горизонте). */
  getUpcomingEventsForNotifications(): Event[] {
    const horizonMs = NOTIFICATIONS_HORIZON_HOURS * MS_PER_HOUR;
    return this.store.getUpcoming(horizonMs);
  }

  /** Найти событие по стабильному ключу (`calendar_id:event_id`). */
  getEventByEventKey(eventKey: string): Event | null {
    return this.store.getByEventKey(eventKey);
  }

  /** Статус данных по календарям (fresh/stale + время/ошибка). */
  getPerCalendarStatus() {
    return this.store.getPerCalendarStatus();
  }

  /**
   * Изменить мой статус участия (PARTSTAT) в календаре и обновить данные.
   *
   * Важно: поддерживается только CalDAV (ICS URL — read-only).
   */
  async setMyPartstat(ev: Event, partstat: NonNullable<Event["status"]>): Promise<void> {
    const cal = this.settings.calendars.find((c) => c.id === ev.calendar.id);
    if (!cal) return await Promise.reject(new AppError({ code: APP_ERROR.NOT_FOUND, message: "Ассистент: календарь не найден" }));
    if (!cal.enabled) return await Promise.reject(new AppError({ code: APP_ERROR.VALIDATION, message: "Ассистент: календарь отключён" }));
    if (cal.type !== "caldav")
      return await Promise.reject(
        new AppError({ code: APP_ERROR.READ_ONLY, message: "Ассистент: этот календарь read-only (ICS URL не поддерживает запись)" }),
      );
    if (!this.providers.rsvpWriter?.setMyPartstat)
      return await Promise.reject(
        new AppError({ code: APP_ERROR.INTERNAL, message: "Ассистент: обратная запись недоступна (нет CalDAV провайдера)" }),
      );
    try {
      await this.providers.rsvpWriter.setMyPartstat(cal, ev, partstat);
    } catch (e) {
      // Нормализуем диагностику обратной записи для UI/use-case'ов
      const dto = toAppErrorDto(e, {
        code: APP_ERROR.CALDAV_WRITEBACK,
        message:
          "Ассистент: не удалось подтвердить изменение статуса в календаре. " +
          "Попробуйте обновить календарь — возможно статус уже изменился. См. лог.",
      });
      return await Promise.reject(new AppError(dto));
    }
    await this.refreshOneAndMerge(cal.id);
  }

  /**
   * Установить “цвет встречи” (COLOR в VEVENT) в календаре и обновить данные.
   *
   * Важно: поддерживается только CalDAV (ICS URL — read-only).
   */
  async setMeetingColor(ev: Event, color: string | null): Promise<void> {
    const cal = this.settings.calendars.find((c) => c.id === ev.calendar.id);
    if (!cal) return await Promise.reject(new AppError({ code: APP_ERROR.NOT_FOUND, message: "Ассистент: календарь не найден" }));
    if (!cal.enabled) return await Promise.reject(new AppError({ code: APP_ERROR.VALIDATION, message: "Ассистент: календарь отключён" }));
    if (cal.type !== "caldav")
      return await Promise.reject(
        new AppError({ code: APP_ERROR.READ_ONLY, message: "Ассистент: этот календарь read-only (ICS URL не поддерживает запись)" }),
      );

    // Google OAuth CalDAV: цвет события из UI живёт в Google Calendar API, а не в VEVENT.
    // Поэтому для google_oauth приоритетно пишем через Google API.
    if (this.googleApi) {
      const account = this.settings.caldav.accounts.find((a) => a.id === cal.caldav?.accountId);
      if (account && (account.authMethod ?? "basic") === "google_oauth") {
        try {
          await this.googleApi.setEventColorForIcalUid({
            account,
            caldavCalendarUrl: String(cal.caldav?.calendarUrl ?? ""),
            iCalUid: String(ev.id ?? ""),
            payload: color,
          });
          await this.refreshOneAndMerge(cal.id);
          return;
        } catch (e) {
          const dto = toAppErrorDto(e, {
            code: APP_ERROR.CALDAV_WRITEBACK,
            message: "Ассистент: не удалось изменить цвет встречи через Google Calendar API. См. лог.",
          });
          return await Promise.reject(new AppError(dto));
        }
      }
    }

    if (!this.providers.meetingColorWriter?.setMeetingColor)
      return await Promise.reject(new AppError({ code: APP_ERROR.INTERNAL, message: "Ассистент: запись цвета недоступна (нет CalDAV провайдера)" }));
    try {
      await this.providers.meetingColorWriter.setMeetingColor(cal, ev, color);
    } catch (e) {
      const dto = toAppErrorDto(e, {
        code: APP_ERROR.CALDAV_WRITEBACK,
        message: "Ассистент: не удалось изменить цвет встречи в календаре. См. лог.",
      });
      return await Promise.reject(new AppError(dto));
    }
    await this.refreshOneAndMerge(cal.id);
  }

  /** Список доступных “ярлыков/цветов” для календаря (из уже загруженных событий + базовый цвет календаря). */
  getCalendarColorLabels(calendarId: string): Array<{ id: string; name: string; color: string }> {
    const g = this.googleLabelsByCalendarId.get(calendarId);
    if (g && g.length) return g.slice();

    const cal = this.settings.calendars.find((c) => c.id === calendarId);
    const base = String((cal as any)?.colorOverride ?? cal?.color ?? "").trim();
    const baseColor = base || DEFAULT_CALENDAR_COLOR;

    const seen = new Set<string>();
    const out: Array<{ id: string; name: string; color: string }> = [];

    // Базовый цвет календаря (fallback)
    seen.add(baseColor.toLowerCase());
    out.push({ id: baseColor, name: `Календарь (${baseColor})`, color: baseColor });

    // Явные COLOR из событий
    for (const ev of this.store.getEvents()) {
      if (String(ev.calendar?.id ?? "") !== calendarId) continue;
      const c = String(ev.color?.value ?? "").trim();
      if (!c) continue;
      const key = c.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: c, name: c, color: c });
    }
    return out;
  }

  /**
   * Инициализировать in-memory стор данными из persistent cache (после рестарта).
   *
   * Семантика: кэш считается “stale”, пока не будет успешного refresh.
   */
  seedFromCache(params: { enabledCalendarIds: string[]; lastGood: Record<string, { fetchedAt: number; events: Event[] }> }): void {
    this.store.seedFromCache({
      enabledCalendarIds: params.enabledCalendarIds,
      lastGood: params.lastGood,
    });
    this.emit();
  }

  /** Экспортировать lastGood данные для persistent cache. */
  exportLastGoodForCache(params: { enabledCalendarIds: string[] }): Record<string, { fetchedAt: number; events: Event[] }> {
    return this.store.exportLastGoodSnapshot({ enabledCalendarIds: params.enabledCalendarIds });
  }

  /**
   * Обновить один календарь и аккуратно смержить результат с остальными (чтобы не терять кэш по другим календарям).
   */
  async refreshOneAndMerge(calendarId: string): Promise<{ events: Event[]; errors: CalendarRefreshError[] }> {
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
        errors: [{ calendarId: cal.id, name: cal.name, error: String((e as unknown) ?? "неизвестная ошибка"), cause: e }],
      };
    }
  }

  /**
   * Обновить все включённые календари.
   * При ошибках не “обнуляет” данные: стор переводит календарь в stale и оставляет lastGood (если был).
   */
  async refreshAll(): Promise<{ events: Event[]; errors: CalendarRefreshError[] }> {
    const enabled = this.settings.calendars.filter((c) => c.enabled);
    const errors: CalendarRefreshError[] = [];

    const results = await Promise.allSettled(
      enabled.map(async (cal) => {
        return await this.refreshOneCalendar(cal);
      }),
    );

    const fetchedAt = Date.now();
    const batchResults: Array<
      { calendarId: string; ok: true; fetchedAt: number; events: Event[] } | { calendarId: string; ok: false; error: string }
    > = [];

    for (let i = 0; i < results.length; i++) {
      const cal = enabled[i];
      const r = results[i];
      if (r.status === "fulfilled") {
        batchResults.push({ calendarId: cal.id, ok: true, fetchedAt, events: r.value });
      } else {
        const reason = (r as PromiseRejectedResult).reason as unknown;
        const err = String((reason as unknown) ?? "неизвестная ошибка");
        batchResults.push({ calendarId: cal.id, ok: false, error: err });
        errors.push({
          calendarId: cal.id,
          name: cal.name,
          error: err,
          cause: reason,
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

  private async refreshOneCalendar(cal: CalendarConfig): Promise<Event[]> {
    const p = this.providers.get(cal.type);
    if (!p) return [];
    const raw = await p.refresh(cal);
    if (!raw.length) return raw;

    // Google OAuth CalDAV: enrich цвета событий через Google Calendar API (batched).
    if (this.googleApi && cal.type === "caldav") {
      const account = this.settings.caldav.accounts.find((a) => a.id === cal.caldav?.accountId);
      if (account && (account.authMethod ?? "basic") === "google_oauth") {
        try {
          const { events, labels } = await this.googleApi.enrichEventColors({
            account,
            caldavCalendarUrl: String(cal.caldav?.calendarUrl ?? ""),
            events: raw,
          });
          if (labels?.length) {
            const custom = (cal as any).googleColorLabels as Record<string, string> | undefined;
            const effective = mergeGoogleEventColorLabels(custom);
            const next = labels.map((l) => {
              const id = String(l.id ?? "").trim();
              if (id.startsWith("google:")) {
                const colorId = id.slice("google:".length).trim();
                const name = String(effective[colorId] ?? "").trim();
                // В UI (контекстное меню) показываем только название метки, без hex.
                if (name) return { ...l, name };
              }
              return l;
            });
            this.googleLabelsByCalendarId.set(cal.id, next);
          }
          const custom = (cal as any).googleColorLabels as Record<string, string> | undefined;
          const effective = mergeGoogleEventColorLabels(custom);
          const withNames = events.map((ev) => {
            const id = String(ev.color?.id ?? "").trim();
            if (!id) return ev;
            const label = String(effective[id] ?? "").trim();
            if (!label) return ev;
            return { ...ev, color: { ...ev.color, name: label } };
          });
          return withNames;
        } catch {
          // Не валим refresh календаря из-за “косметики” (цвета). События без цветов тоже полезны.
          return raw;
        }
      }
    }

    return raw;
  }

  private emit() {
    for (const cb of this.listeners) cb();
  }
}
