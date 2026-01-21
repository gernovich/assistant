import { requestUrl } from "obsidian";
import type { AssistantSettings, Calendar, CalendarConfig, Event } from "../../types";
import { parseIcs } from "../ics";
import type { CalendarProvider } from "./calendarProvider";
import { CALENDAR_EVENTS_HORIZON_DAYS } from "../constants";

/** Провайдер календаря по ICS URL (скачиваем .ics и парсим события). */
export class IcsUrlProvider implements CalendarProvider {
  /** Тип источника календаря. */
  type: CalendarConfig["type"] = "ics_url";

  constructor(private settings: AssistantSettings) {}

  /** Применить новые настройки без пересоздания провайдера. */
  setSettings(settings: AssistantSettings) {
    this.settings = settings;
  }

  /** Обновить события календаря из ICS URL. */
  async refresh(cal: CalendarConfig): Promise<Event[]> {
    const url = (cal.url ?? "").trim();
    if (!url) return [];

    const res = await requestUrl({ url });
    const text = res.text ?? "";
    const calendar: Calendar = { id: cal.id, name: cal.name, type: cal.type, config: cal };
    return parseIcs(calendar, text, {
      now: new Date(),
      horizonDays: CALENDAR_EVENTS_HORIZON_DAYS,
      myEmail: this.settings.calendar.myEmail,
    });
  }
}
