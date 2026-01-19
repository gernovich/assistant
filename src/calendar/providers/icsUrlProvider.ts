import { requestUrl } from "obsidian";
import type { AssistantSettings, CalendarConfig, CalendarEvent } from "../../types";
import { parseIcs } from "../ics";
import type { CalendarProvider } from "./calendarProvider";

export class IcsUrlProvider implements CalendarProvider {
  type: CalendarConfig["type"] = "ics_url";

  constructor(private settings: AssistantSettings) {}

  setSettings(settings: AssistantSettings) {
    this.settings = settings;
  }

  async refresh(cal: CalendarConfig): Promise<CalendarEvent[]> {
    const url = (cal.url ?? "").trim();
    if (!url) return [];

    const res = await requestUrl({ url });
    const text = res.text ?? "";
    return parseIcs(cal.id, text, {
      now: new Date(),
      horizonDays: 60,
      myEmail: this.settings.calendar.myEmail,
    });
  }
}

