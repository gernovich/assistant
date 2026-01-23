import type { AssistantSettings, Event } from "../../types";
import type { CalendarService } from "../../calendar/calendarService";

export type AgendaProtocolMenuState = {
  hasCurrent: boolean;
  hasLatest: boolean;
  currentIsLatest: boolean;
};

export type AgendaControllerActions = {
  openLog: () => void;
  openEvent: (ev: Event) => void;
  openRecorder: (ev: Event) => void | Promise<void>;

  setMyPartstat: (ev: Event, partstat: NonNullable<Event["status"]>) => Promise<void> | void;

  getProtocolMenuState: (ev: Event) => Promise<AgendaProtocolMenuState>;
  openCurrentProtocol: (ev: Event) => void | Promise<void>;
  openLatestProtocol: (ev: Event) => void | Promise<void>;
  createProtocol: (ev: Event) => unknown | Promise<unknown>;

  debugShowReminder: (ev: Event) => void;
};

export class AgendaController {
  private settings: AssistantSettings;

  constructor(
    settings: AssistantSettings,
    private readonly calendarService: CalendarService,
    private readonly actions: AgendaControllerActions,
  ) {
    this.settings = settings;
  }

  setSettings(settings: AssistantSettings): void {
    this.settings = settings;
  }

  onChange(cb: () => void): () => void {
    return this.calendarService.onChange(cb);
  }

  getRefreshResult() {
    return this.calendarService.getRefreshResult();
  }

  getDayEvents(dayOffset: number): Event[] {
    return this.calendarService.getDayEvents(dayOffset, this.settings.agenda.maxEvents);
  }

  /** Найти ближайшее предстоящее событие (для UX, когда на выбранный день пусто). */
  getNextEventAfterNow(nowMs: number = Date.now()): Event | null {
    const all = this.calendarService.getEvents();
    for (const ev of all) {
      const t = ev.start?.getTime?.() ?? NaN;
      if (Number.isFinite(t) && t >= nowMs) return ev;
    }
    return null;
  }

  openLog(): void {
    this.actions.openLog();
  }

  openEvent(ev: Event): void {
    this.actions.openEvent(ev);
  }

  openRecorder(ev: Event): void | Promise<void> {
    return this.actions.openRecorder(ev);
  }

  setMyPartstat(ev: Event, partstat: NonNullable<Event["status"]>): Promise<void> | void {
    return this.actions.setMyPartstat(ev, partstat);
  }

  getProtocolMenuState(ev: Event): Promise<AgendaProtocolMenuState> {
    return this.actions.getProtocolMenuState(ev);
  }

  openCurrentProtocol(ev: Event): void | Promise<void> {
    return this.actions.openCurrentProtocol(ev);
  }

  openLatestProtocol(ev: Event): void | Promise<void> {
    return this.actions.openLatestProtocol(ev);
  }

  createProtocol(ev: Event): unknown | Promise<unknown> {
    return this.actions.createProtocol(ev);
  }

  debugShowReminder(ev: Event): void {
    this.actions.debugShowReminder(ev);
  }
}
