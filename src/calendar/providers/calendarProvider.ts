import type { CalendarConfig, Event } from "../../types";

/** Интерфейс провайдера календаря (ICS URL, CalDAV и т.п.). */
export interface CalendarProvider {
  /** Тип календаря, который обслуживает провайдер. */
  type: CalendarConfig["type"];
  /** Обновить события календаря. */
  refresh(cal: CalendarConfig): Promise<Event[]>;
}
