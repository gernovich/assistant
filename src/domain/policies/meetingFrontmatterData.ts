import type { Event, RsvpStatus } from "../../types";
import { makePersonIdFromEmail } from "../../ids/stableIds";
import { groupAttendeePersonIds } from "./attendeesGrouping";

export type MeetingFrontmatterData = {
  assistantType: "calendar_event";
  calendarId: string;
  eventId: string;
  summary: string;
  startIso: string;
  endIso: string;
  url?: string;
  location?: string;
  status?: RsvpStatus;
  organizerEmail?: string;
  organizerCn?: string;
  timezone?: string;
  rrule?: string;
  remindersMinutesBefore?: number[];
  eventColor?: string;
  attendeesAll: string[];
  attendeesAccepted: string[];
  attendeesDeclined: string[];
  attendeesTentative: string[];
  attendeesNeedsAction: string[];
  attendeesUnknown: string[];
};

/**
 * Политика: извлечь данные для frontmatter карточки встречи из Event.
 *
 * Чистая функция: без Obsidian/Vault. Использует только детерминированные преобразования.
 */
export function buildMeetingFrontmatterData(ev: Event): MeetingFrontmatterData {
  const startIso = ev.start.toISOString();
  const endIso = ev.end ? ev.end.toISOString() : "";

  const grouped = groupAttendeePersonIds(ev.attendees ?? [], makePersonIdFromEmail);

  const organizerEmail = String(ev.organizer?.emails?.[0] ?? "").trim() || undefined;
  const organizerCn = String(ev.organizer?.displayName ?? "").trim() || undefined;

  const remindersMinutesBefore = (ev.reminders ?? [])
    .map((r) => r.minutesBefore)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));

  return {
    assistantType: "calendar_event",
    calendarId: ev.calendar.id,
    eventId: ev.id,
    summary: ev.summary,
    startIso,
    endIso,
    url: ev.url,
    location: ev.location,
    status: ev.status,
    organizerEmail,
    organizerCn,
    timezone: ev.timeZone,
    rrule: ev.recurrence?.rrule,
    remindersMinutesBefore: remindersMinutesBefore.length ? remindersMinutesBefore : undefined,
    eventColor: ev.color?.value,
    attendeesAll: grouped.all,
    attendeesAccepted: grouped.accepted,
    attendeesDeclined: grouped.declined,
    attendeesTentative: grouped.tentative,
    attendeesNeedsAction: grouped.needsAction,
    attendeesUnknown: grouped.unknown,
  };
}
