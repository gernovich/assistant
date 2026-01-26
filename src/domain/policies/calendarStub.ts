import type { Calendar, CalendarConfig, CalendarId, CalendarSourceType } from "../../types";

/**
 * Политика: минимальный Calendar DTO по `calendar_id`, когда у нас есть только идентичность (например из frontmatter).
 *
 * Важно:
 * - реальная конфигурация/тип календаря берётся из `settings.calendars` по `id`
 * - этот stub нужен, чтобы не плодить `as any` и держать типы строгими
 */
export function makeCalendarStub(params: { id: CalendarId; name?: string; type?: CalendarSourceType }): Calendar {
  const id = params.id;
  const name = params.name ?? String(id ?? "");
  const type: CalendarSourceType = params.type ?? "ics_url";
  const config: CalendarConfig =
    type === "caldav"
      ? { id, name, type: "caldav", enabled: true, caldav: { accountId: "", calendarUrl: "" } }
      : { id, name, type: "ics_url", enabled: true, url: "" };
  return { id, name, type, config };
}
