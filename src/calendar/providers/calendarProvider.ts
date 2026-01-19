import type { CalendarConfig, CalendarEvent } from "../../types";

/** Интерфейс провайдера календаря (ICS URL, CalDAV и т.п.). */
export interface CalendarProvider {
  /** Тип календаря, который обслуживает провайдер. */
  type: CalendarConfig["type"];
  /** Обновить события календаря. */
  refresh(cal: CalendarConfig): Promise<CalendarEvent[]>;
}
