import type { AssistantSettings, CalendarConfig, CalendarEvent } from "../types";
import { IcsUrlProvider } from "./providers/icsUrlProvider";
import { CaldavProvider } from "./providers/caldavProvider";

type Listener = () => void;

export interface CalendarRefreshError {
  calendarId: string;
  name: string;
  error: string;
}

export class CalendarService {
  private settings: AssistantSettings;
  private events: CalendarEvent[] = [];
  private listeners = new Set<Listener>();
  private icsUrlProvider: IcsUrlProvider;
  private caldavProvider: CaldavProvider;

  constructor(settings: AssistantSettings) {
    this.settings = settings;
    this.icsUrlProvider = new IcsUrlProvider(settings);
    this.caldavProvider = new CaldavProvider(settings);
  }

  setSettings(settings: AssistantSettings) {
    this.settings = settings;
    this.icsUrlProvider.setSettings(settings);
    this.caldavProvider.setSettings(settings);
  }

  onChange(cb: Listener) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getEvents(): CalendarEvent[] {
    return this.events.slice();
  }

  async refreshOneAndMerge(calendarId: string): Promise<{ events: CalendarEvent[]; errors: CalendarRefreshError[] }> {
    const cal = this.settings.calendars.find((c) => c.id === calendarId);
    if (!cal) {
      return {
        events: this.getEvents(),
        errors: [{ calendarId, name: "", error: "calendar not found" }],
      };
    }
    if (!cal.enabled) {
      // Keep semantics: disabled calendars should not contribute events.
      return {
        events: this.getEvents(),
        errors: [{ calendarId: cal.id, name: cal.name, error: "calendar is disabled" }],
      };
    }

    try {
      const newEvents = await this.refreshOneCalendar(cal);
      const kept = this.events.filter((e) => e.calendarId !== cal.id);
      const merged = kept.concat(newEvents);
      merged.sort((a, b) => a.start.getTime() - b.start.getTime());
      this.events = merged;
      this.emit();
      return { events: this.getEvents(), errors: [] };
    } catch (e) {
      return {
        events: this.getEvents(),
        errors: [{ calendarId: cal.id, name: cal.name, error: String((e as unknown) ?? "unknown error") }],
      };
    }
  }

  async refreshAll(): Promise<{ events: CalendarEvent[]; errors: CalendarRefreshError[] }> {
    const enabled = this.settings.calendars.filter((c) => c.enabled);
    const all: CalendarEvent[] = [];
    const errors: CalendarRefreshError[] = [];

    const results = await Promise.allSettled(
      enabled.map(async (cal) => {
        return await this.refreshOneCalendar(cal);
      }),
    );

    for (let i = 0; i < results.length; i++) {
      const cal = enabled[i];
      const r = results[i];
      if (r.status === "fulfilled") {
        all.push(...r.value);
      } else {
        errors.push({
          calendarId: cal.id,
          name: cal.name,
          error: String((r.reason as unknown) ?? "unknown error"),
        });
      }
    }

    all.sort((a, b) => a.start.getTime() - b.start.getTime());
    this.events = all;
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

