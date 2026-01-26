import type { AssistantSettings, Event } from "../../types";
import { normalizeEmail } from "./normalizeEmail";

/** Политика: парсинг списка email из строки настроек (разделители: `,`, `;`, пробелы). */
export function splitEmailsPolicy(raw: string): string[] {
  return String(raw ?? "")
    .split(/[,\s;]+/g)
    .map((x) => normalizeEmail(x))
    .filter(Boolean);
}

/**
 * Политика: определить “мои email” для RSVP по событию.
 *
 * 1) берём `settings.calendar.myEmail`
 * 2) если пусто и календарь CalDAV — берём `account.username`
 */
export function myEmailsForEventPolicy(settings: AssistantSettings, ev: Event): string[] {
  const cfg = settings.calendars.find((c) => c.id === ev.calendar.id);
  let raw = String(settings.calendar.myEmail ?? "").trim();
  if (!raw && cfg?.type === "caldav") {
    const acc = settings.caldav.accounts.find((a) => a.id === cfg.caldav?.accountId);
    raw = String(acc?.username ?? "").trim();
  }
  return splitEmailsPolicy(raw);
}

/** Политика: проверка, что среди ATTENDEE есть хотя бы один из “моих email”. */
export function hasMyAttendeePolicy(ev: Event, myEmails: string[]): boolean {
  if (!myEmails.length) return false;
  const a = ev.attendees ?? [];
  for (const x of a) {
    const email = normalizeEmail(String(x?.email ?? ""));
    if (email && myEmails.includes(email)) return true;
  }
  return false;
}
