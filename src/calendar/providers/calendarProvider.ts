import type { CalendarConfig, CalendarEvent } from "../../types";

export interface CalendarProvider {
  type: CalendarConfig["type"];
  refresh(cal: CalendarConfig): Promise<CalendarEvent[]>;
}

