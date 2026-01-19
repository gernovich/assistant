import type { CalendarService } from "../calendar/calendarService";
import type { EventNoteService } from "../calendar/eventNoteService";
import type { LogService } from "../log/logService";
import type { NotificationScheduler } from "../notifications/notificationScheduler";
import type { AssistantSettings } from "../types";

export class SyncService {
  constructor(
    private calendarService: CalendarService,
    private eventNoteService: EventNoteService,
    private notificationScheduler: NotificationScheduler,
    private log: LogService,
  ) {}

  applySettings(settings: AssistantSettings) {
    this.calendarService.setSettings(settings);
    this.notificationScheduler.setSettings(settings);
    this.eventNoteService.setEventsDir(settings.folders.calendarEvents);
  }

  async refreshCalendarsAndSync(settings: AssistantSettings) {
    this.log.info("Обновление календарей: старт", {
      enabledCalendars: settings.calendars.filter((c) => c.enabled).length,
    });

    const { events, errors } = await this.calendarService.refreshAll();

    for (const e of errors) {
      this.log.warn("Календарь: ошибка обновления", { calendarId: e.calendarId, name: e.name, error: e.error });
    }

    // Не создаем прошедшие встречи при фоновом/ручном обновлении.
    // Прошедшие встречи создаются по клику (on-demand) через openEvent().
    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.getTime();
    const horizonMs = 60 * 24 * 60 * 60_000; // 60 дней вперед (защита от бесконечной ленты)
    const until = now + horizonMs;

    const eventsForNotes = events.filter((e) => {
      const start = e.start.getTime();
      const end = e.end?.getTime() ?? start;
      const notPast = end >= todayStart;
      const notTooFar = start <= until;
      return notPast && notTooFar;
    });

    // Встречи могут быть повторяющимися (RRULE) => в списке могут быть несколько occurrences с одним uid.
    // Для заметок в vault мы держим 1 файл на uid, поэтому синкаем только ближайшую upcoming встречу по (calendarId, uid).
    const uniqueForNotes = pickEarliestPerKey(eventsForNotes);
    await this.eventNoteService.syncEvents(uniqueForNotes);
    this.notificationScheduler.schedule(events);
    this.log.info("Обновление календарей: ok", { events: events.length });
  }

  async syncFromCurrentEvents(settings: AssistantSettings) {
    const events = this.calendarService.getEvents();

    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.getTime();
    const horizonMs = 60 * 24 * 60 * 60_000;
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
    this.notificationScheduler.schedule(events);
  }
}

function pickEarliestPerKey(events: { calendarId: string; uid: string; start: Date }[]): typeof events {
  const map = new Map<string, (typeof events)[number]>();
  for (const ev of events) {
    const key = `${ev.calendarId}:${ev.uid}`;
    const prev = map.get(key);
    if (!prev || ev.start.getTime() < prev.start.getTime()) map.set(key, ev);
  }
  return Array.from(map.values());
}
