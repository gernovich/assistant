import type { AssistantSettings, CalendarConfig, Event } from "../../types";
import { CaldavProvider } from "./caldavProvider";
import type { CalendarProvider } from "./calendarProvider";
import { IcsUrlProvider } from "./icsUrlProvider";

/** Интерфейс для write-back RSVP (только CalDAV сейчас). */
export interface CalendarRsvpWriter {
  setMyPartstat(cal: CalendarConfig, ev: Event, partstat: NonNullable<Event["status"]>): Promise<void>;
  setSettings?(settings: AssistantSettings): void;
}

export interface CalendarProviderRegistry {
  get(type: CalendarConfig["type"]): CalendarProvider | undefined;
  setSettings(settings: AssistantSettings): void;
  /** Write-back (может быть undefined, если нет провайдера записи). */
  rsvpWriter?: CalendarRsvpWriter;
}

export function createDefaultCalendarProviderRegistry(settings: AssistantSettings): CalendarProviderRegistry {
  const ics = new IcsUrlProvider(settings);
  const caldav = new CaldavProvider(settings);

  const byType = new Map<CalendarConfig["type"], CalendarProvider>([
    ["ics_url", ics],
    ["caldav", caldav],
  ]);

  return {
    get(type) {
      return byType.get(type);
    },
    setSettings(s) {
      for (const p of byType.values()) p.setSettings?.(s);
      // CaldavProvider тоже нужно обновлять (клиенты/настройки)
      try {
        (caldav as unknown as CalendarRsvpWriter).setSettings?.(s);
      } catch {
        // ignore
      }
    },
    rsvpWriter: caldav as unknown as CalendarRsvpWriter,
  };
}
