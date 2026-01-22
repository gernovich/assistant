import type { CalendarService } from "../calendar/calendarService";
import type { LogService } from "../log/logService";
import type { NotificationScheduler } from "../notifications/notificationScheduler";
import type { AssistantSettings } from "../types";
import { MS_PER_DAY, NOTES_SYNC_HORIZON_DAYS } from "../calendar/constants";
import type { MeetingNoteRepository } from "../application/contracts/meetingNoteRepository";
import type { PersonRepository } from "../application/contracts/personRepository";

/**
 * Оркестратор обновления/синхронизации:
 * - refresh календарей (`CalendarService`)
 * - sync заметок встреч (`EventNoteService`)
 * - расписание уведомлений (`NotificationScheduler`)
 */
export class SyncService {
  constructor(
    private calendarService: CalendarService,
    private eventNoteService: MeetingNoteRepository,
    private notificationScheduler: NotificationScheduler,
    private log: LogService,
    private personNoteService?: PersonRepository,
  ) {}

  /** Применить новые настройки к зависимым сервисам. */
  applySettings(settings: AssistantSettings) {
    this.calendarService.setSettings(settings);
    this.notificationScheduler.setSettings(settings);
    this.eventNoteService.setEventsDir(settings.folders.calendarEvents);
  }

  /** Полный цикл: refresh календарей → sync заметок → планирование уведомлений. */
  async refreshCalendarsAndSync(settings: AssistantSettings) {
    this.log.info("Обновление календарей: старт", {
      enabledCalendars: settings.calendars.filter((c) => c.enabled).length,
    });

    const { errors } = await this.calendarService.refreshAll();
    const rr = this.calendarService.getRefreshResult();
    const events = rr.events;

    for (const e of errors) {
      this.log.warn("Календарь: ошибка обновления", { calendarId: e.calendarId, name: e.name, error: e.error });
    }

    // Offline-first UX: если календарь не обновился, но у нас есть lastGood — продолжаем показывать кэш.
    // В логе должно быть явно видно, что данные устарели.
    const status = rr.perCalendar;
    const calNameById = new Map(settings.calendars.map((c) => [c.id, c.name]));
    for (const [calendarId, s] of Object.entries(status)) {
      if (s.status !== "stale") continue;
      const name = calNameById.get(calendarId) ?? "";
      const lastOk = s.fetchedAt ? new Date(s.fetchedAt).toISOString() : "";
      this.log.warn("Календарь: обновление не удалось, использую кэш", {
        calendarId,
        name,
        lastOkAt: lastOk,
        error: s.error ?? "",
      });
    }

    // Не создаем прошедшие встречи при фоновом/ручном обновлении.
    // Прошедшие встречи создаются по клику (on-demand) через openEvent().
    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.getTime();
    const horizonMs = NOTES_SYNC_HORIZON_DAYS * MS_PER_DAY; // защита от бесконечной ленты
    const until = now + horizonMs;

    const eventsForNotes = events.filter((e) => {
      const start = e.start.getTime();
      const end = e.end?.getTime() ?? start;
      const notPast = end >= todayStart;
      const notTooFar = start <= until;
      return notPast && notTooFar;
    });

    // Встречи могут быть повторяющимися (RRULE) => в списке могут быть несколько occurrences с одним uid.
    // Для заметок в vault мы держим 1 файл на id (UID), поэтому синкаем только ближайшую upcoming встречу по (calendar.id, id).
    const uniqueForNotes = pickEarliestPerKey(eventsForNotes);
    await this.eventNoteService.syncEvents(uniqueForNotes);
    await this.ensurePeopleCardsFromEvents(uniqueForNotes);
    this.notificationScheduler.schedule(events);
    this.log.info("Обновление календарей: ok", { events: events.length });
  }

  /** Синхронизация на основе уже загруженных текущих событий (без network refresh). */
  async syncFromCurrentEvents(settings: AssistantSettings) {
    const events = this.calendarService.getEvents();

    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.getTime();
    const horizonMs = NOTES_SYNC_HORIZON_DAYS * MS_PER_DAY;
    const until = now + horizonMs;

    const eventsForNotes = events.filter((e) => {
      const start = e.start.getTime();
      const end = e.end?.getTime() ?? start;
      const notPast = end >= todayStart;
      const notTooFar = start <= until;
      return notPast && notTooFar;
    });

    const uniqueForNotes = pickEarliestPerKey(eventsForNotes);
    await this.eventNoteService.syncEvents(uniqueForNotes);
    await this.ensurePeopleCardsFromEvents(uniqueForNotes);
    this.notificationScheduler.schedule(events);
  }

  private async ensurePeopleCardsFromEvents(events: Array<{ attendees?: Array<{ email: string; cn?: string }> }>): Promise<void> {
    if (!this.personNoteService) return;
    const emails = new Set<string>();
    for (const ev of events) {
      for (const a of ev.attendees ?? []) {
        const email = String(a?.email ?? "").trim();
        if (email) emails.add(email);
      }
    }
    for (const email of emails) {
      try {
        await this.personNoteService.ensureByEmail({ email });
      } catch {
        // не валим sync из-за одной “битой” карточки
      }
    }
  }
}

function pickEarliestPerKey<T extends { calendar: { id: string }; id: string; start: Date }>(events: T[]): T[] {
  const map = new Map<string, T>();
  for (const ev of events) {
    const key = `${ev.calendar.id}:${ev.id}`;
    const prev = map.get(key);
    if (!prev || ev.start.getTime() < prev.start.getTime()) map.set(key, ev);
  }
  return Array.from(map.values());
}
