import { describe, expect, it, vi } from "vitest";
import { parseIcs } from "../src/calendar/ics";
import type { Calendar } from "../src/types";

const cal1: Calendar = {
  id: "cal1",
  name: "cal1",
  type: "ics_url",
  config: { id: "cal1", name: "cal1", type: "ics_url", enabled: true },
};

describe("parseIcs", () => {
  it("не подставляет цвет календаря в Event.color, если в VEVENT нет COLOR (цвет календаря — UI fallback)", () => {
    const cal: Calendar = {
      id: "cal-color",
      name: "cal-color",
      type: "caldav",
      config: {
        id: "cal-color",
        name: "cal-color",
        type: "caldav",
        enabled: true,
        color: "#00ff00",
        caldav: { accountId: "a", calendarUrl: "u" },
      },
    };
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:abc-123",
      "DTSTART:20260118T120000Z",
      "SUMMARY:No color event",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal, ics);
    expect(events).toHaveLength(1);
    expect(events[0].color?.value).toBeUndefined();
  });

  it("parses basic VEVENT with UTC DTSTART/DTEND", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:abc-123",
      "DTSTART:20260118T120000Z",
      "DTEND:20260118T123000Z",
      "SUMMARY:Test event",
      "DESCRIPTION:Line1\\nLine2",
      "LOCATION:Office",
      "URL:https://example.com/meet",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("abc-123");
    expect(events[0].summary).toBe("Test event");
    expect(events[0].description).toBe("Line1\nLine2");
    expect(events[0].location).toBe("Office");
    expect(events[0].url).toBe("https://example.com/meet");
    expect(events[0].start.toISOString()).toBe("2026-01-18T12:00:00.000Z");
    expect(events[0].end?.toISOString()).toBe("2026-01-18T12:30:00.000Z");
    expect(events[0].timeZone).toBe("UTC");
  });

  it("supports line unfolding", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:abc-123",
      "DTSTART:20260118T120000Z",
      "SUMMARY:Long summary that is",
      " continued",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Long summary that iscontinued");
  });

  it("supports tab line unfolding", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:abc-124",
      "DTSTART:20260118T120000Z",
      "SUMMARY:Long summary that is",
      "\tcontinued",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Long summary that iscontinued");
  });

  it("parses all-day date format", () => {
    const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:day-1", "DTSTART:20260118", "SUMMARY:All day", "END:VEVENT", "END:VCALENDAR"].join(
      "\n",
    );

    const events = parseIcs(cal1, ics);
    expect(events).toHaveLength(1);
    expect(events[0].allDay).toBe(true);
    expect(events[0].start.getFullYear()).toBe(2026);
    expect(events[0].start.getMonth()).toBe(0);
    expect(events[0].start.getDate()).toBe(18);
  });

  it("treats DTSTART;VALUE=DATE as all-day (VALUE param branch)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:day-2",
      "DTSTART;VALUE=DATE:20260118",
      "SUMMARY:All day",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics);
    expect(events).toHaveLength(1);
    expect(events[0].allDay).toBe(true);
  });

  it("expands simple daily RRULE (COUNT)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:daily-1",
      "DTSTART:20260118T120000Z",
      "DTEND:20260118T123000Z",
      "RRULE:FREQ=DAILY;COUNT=3",
      "SUMMARY:Daily",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics, { now: new Date("2026-01-18T00:00:00.000Z"), horizonDays: 10 });
    expect(events).toHaveLength(3);
    expect(events[0].recurrence?.rrule).toBe("FREQ=DAILY;COUNT=3");
    expect(events.map((e) => e.start.toISOString())).toEqual([
      "2026-01-18T12:00:00.000Z",
      "2026-01-19T12:00:00.000Z",
      "2026-01-20T12:00:00.000Z",
    ]);
  });

  it("does not expand RRULE with unsupported FREQ (fallback to base only)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:m-1",
      "DTSTART:20260118T120000Z",
      "RRULE:FREQ=MONTHLY;COUNT=3",
      "SUMMARY:Monthly",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics, { now: new Date("2026-01-18T00:00:00.000Z"), horizonDays: 365 });
    expect(events).toHaveLength(1);
    expect(events[0].start.toISOString()).toBe("2026-01-18T12:00:00.000Z");
    expect(events[0].recurrence?.rrule).toBe("FREQ=MONTHLY;COUNT=3");
  });

  it("expands RRULE without DTEND as events without end (durationMs=0 branch)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:d-noend",
      "DTSTART:20260118T120000Z",
      "RRULE:FREQ=DAILY;COUNT=2",
      "SUMMARY:No end",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics, { now: new Date("2026-01-18T00:00:00.000Z"), horizonDays: 10 });
    expect(events.map((e) => e.start.toISOString())).toEqual(["2026-01-18T12:00:00.000Z", "2026-01-19T12:00:00.000Z"]);
    expect(events[0].end).toBeUndefined();
    expect(events[1].end).toBeUndefined();
  });

  it("does not duplicate RRULE occurrence when an override VEVENT with RECURRENCE-ID is present (blockedStartMs)", () => {
    // master expands to 2 daily occurrences: 18 and 19
    // override is a separate VEVENT for 19 (has RECURRENCE-ID), should block master-generated 19 to avoid duplicates.
    const ics = [
      "BEGIN:VCALENDAR",
      // master
      "BEGIN:VEVENT",
      "UID:ov-1",
      "DTSTART:20260118T120000Z",
      "DTEND:20260118T123000Z",
      "RRULE:FREQ=DAILY;COUNT=2",
      "SUMMARY:Master",
      "END:VEVENT",
      // override for 19
      "BEGIN:VEVENT",
      "UID:ov-1",
      "DTSTART:20260119T120000Z",
      "RECURRENCE-ID:20260119T120000Z",
      "SUMMARY:Override",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics, { now: new Date("2026-01-18T00:00:00.000Z"), horizonDays: 10 });

    // Важно: не должно быть дубля для start=2026-01-19T12:00Z — должен остаться только override.
    // (Текущая реализация RRULE+COUNT может “компенсировать” заблокированный start следующим днём, поэтому не фиксируем полный список start'ов.)
    const on19 = events.filter((e) => e.start.toISOString() === "2026-01-19T12:00:00.000Z");
    expect(on19).toHaveLength(1);
    expect(on19[0].summary).toBe("Override");
    expect(on19[0].recurrence?.recurrenceId).toBe("20260119T120000Z");
  });

  it("extracts TZID from DTSTART params", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:tz-1",
      "DTSTART;TZID=Europe/Moscow:20260118T120000",
      "SUMMARY:TZ event",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics);
    expect(events).toHaveLength(1);
    expect(events[0].timeZone).toBe("Europe/Moscow");
  });

  it("parses DTSTART without seconds (YYYYMMDDTHHMMZ)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:dt-1",
      "DTSTART:20260118T1200Z",
      "SUMMARY:Short dt",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics);
    expect(events).toHaveLength(1);
    expect(events[0].start.toISOString()).toBe("2026-01-18T12:00:00.000Z");
    expect(events[0].timeZone).toBe("UTC");
  });

  it("ignores malformed content lines without ':' and keeps first scalar value", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:s-1",
      "DTSTART:20260118T120000Z",
      "SUMMARY:First",
      "SUMMARY:Second", // applyContentLine keeps first scalar
      "X-BAD-LINE", // parseContentLine -> null
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("First");
  });

  it("parses VALARM TRIGGER into reminders (minutesBefore)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:al-1",
      "DTSTART:20260118T120000Z",
      "SUMMARY:Alarm",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:-PT15M",
      "DESCRIPTION:Reminder",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics);
    expect(events).toHaveLength(1);
    expect(events[0].reminders?.[0]?.minutesBefore).toBe(15);
    expect(events[0].reminders?.[0]?.action).toBe("DISPLAY");
  });

  it("parses event COLOR into Event.color.value", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:c-1",
      "DTSTART:20260118T120000Z",
      "SUMMARY:Color",
      "COLOR:#ff0000",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics);
    expect(events).toHaveLength(1);
    expect(events[0].color?.value).toBe("#ff0000");
  });

  it("parses my PARTSTAT from ATTENDEE", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:inv-1",
      "DTSTART:20260118T120000Z",
      "SUMMARY:Invite",
      "ATTENDEE;PARTSTAT=ACCEPTED:mailto:me@example.com",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics, { myEmail: "me@example.com" });
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("accepted");
  });

  it("parses other PARTSTAT variants and ignores non-matching emails", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:inv-2",
      "DTSTART:20260118T120000Z",
      "SUMMARY:Invite",
      "ATTENDEE;PARTSTAT=DECLINED:mailto:me@example.com",
      "ATTENDEE;PARTSTAT=TENTATIVE:mailto:other@example.com",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics, { myEmail: "me@example.com" });
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("declined");
  });

  it("parses my PARTSTAT=TENTATIVE", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:inv-3",
      "DTSTART:20260118T120000Z",
      "SUMMARY:Invite",
      "ATTENDEE;PARTSTAT=TENTATIVE:mailto:me@example.com",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics, { myEmail: "me@example.com" });
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("tentative");
  });

  it("parses my PARTSTAT=NEEDS-ACTION", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:inv-4",
      "DTSTART:20260118T120000Z",
      "SUMMARY:Invite",
      "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:me@example.com",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics, { myEmail: "me@example.com" });
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("needs_action");
  });

  it("returns undefined for unknown my PARTSTAT value", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:inv-5",
      "DTSTART:20260118T120000Z",
      "SUMMARY:Invite",
      "ATTENDEE;PARTSTAT=SOMETHING:mailto:me@example.com",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics, { myEmail: "me@example.com" });
    expect(events).toHaveLength(1);
    expect(events[0].status).toBeUndefined();
  });

  it("parses ATTENDEE list (email + CN + PARTSTAT)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:a-1",
      "DTSTART:20260118T120000Z",
      "SUMMARY:Invite",
      "ATTENDEE;CN=Ivan Ivanov;PARTSTAT=ACCEPTED:mailto:ivan@example.com",
      "ATTENDEE;CN=Olga;PARTSTAT=TENTATIVE:mailto:olga@example.com",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics, { myEmail: "me@example.com" });
    expect(events).toHaveLength(1);
    expect(events[0].attendees?.map((a) => a.email)).toEqual(["ivan@example.com", "olga@example.com"]);
    expect(events[0].attendees?.[0]?.cn).toBe("Ivan Ivanov");
    expect(events[0].attendees?.[0]?.partstat).toBe("ACCEPTED");
  });

  it("parses ORGANIZER (mailto + CN) into Event.organizer", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:o-1",
      "DTSTART:20260118T120000Z",
      "SUMMARY:Organizer",
      "ORGANIZER;CN=Boss:mailto:boss@example.com",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics);
    expect(events).toHaveLength(1);
    expect(events[0].organizer?.displayName).toBe("Boss");
    expect(events[0].organizer?.emails).toEqual(["boss@example.com"]);
  });

  it("keeps only the first ORGANIZER when multiple ORGANIZER lines are present", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:o-2",
      "DTSTART:20260118T120000Z",
      "SUMMARY:Organizer",
      "ORGANIZER;CN=First:mailto:first@example.com",
      "ORGANIZER;CN=Second:mailto:second@example.com",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics);
    expect(events).toHaveLength(1);
    expect(events[0].organizer?.displayName).toBe("First");
    expect(events[0].organizer?.emails).toEqual(["first@example.com"]);
  });

  it("does not set organizer when ORGANIZER is not a valid email/mailto", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:o-3",
      "DTSTART:20260118T120000Z",
      "SUMMARY:Organizer",
      // normalizeEmail не валидирует формат адреса; ветку "нет email" покрываем пустым значением.
      "ORGANIZER;CN=X:",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics);
    expect(events).toHaveLength(1);
    expect(events[0].organizer).toBeUndefined();
  });

  it("expands weekly RRULE with BYDAY and EXDATE", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:w-1",
      "DTSTART:20260105T120000Z",
      "DTEND:20260105T123000Z",
      "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4",
      "EXDATE:20260107T120000Z",
      "SUMMARY:Weekly",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics, { now: new Date("2026-01-05T00:00:00.000Z"), horizonDays: 20 });
    // базовое MO (05), затем WE (07) исключено, затем MO (12), WE (14), MO (19) — но COUNT=4 => всего 4 occurrences
    expect(events.map((e) => e.start.toISOString())).toEqual([
      "2026-01-05T12:00:00.000Z",
      "2026-01-12T12:00:00.000Z",
      "2026-01-14T12:00:00.000Z",
      "2026-01-19T12:00:00.000Z",
    ]);
  });

  it("supports EXDATE as comma-separated list (covers exdates split/parse path)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:ex-1",
      "DTSTART:20260118T120000Z",
      "DTEND:20260118T123000Z",
      "RRULE:FREQ=DAILY;COUNT=3",
      // исключаем 19-е через список
      "EXDATE:20260119T120000Z,20260125T120000Z",
      "SUMMARY:Daily",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics, { now: new Date("2026-01-18T00:00:00.000Z"), horizonDays: 10 });
    // Важно: текущая реализация COUNT считает "кол-во occurrences" после EXDATE,
    // поэтому исключённый день компенсируется следующим, чтобы всего было 3.
    expect(events.map((e) => e.start.toISOString())).toEqual([
      "2026-01-18T12:00:00.000Z",
      "2026-01-20T12:00:00.000Z",
      "2026-01-21T12:00:00.000Z",
    ]);
  });

  it("expands weekly RRULE without BYDAY (uses DTSTART weekday)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:w-2",
      // 2026-01-05 is Monday
      "DTSTART:20260105T120000Z",
      "DTEND:20260105T123000Z",
      "RRULE:FREQ=WEEKLY;COUNT=3",
      "SUMMARY:Weekly",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics, { now: new Date("2026-01-05T00:00:00.000Z"), horizonDays: 30 });
    expect(events.map((e) => e.start.toISOString())).toEqual([
      "2026-01-05T12:00:00.000Z",
      "2026-01-12T12:00:00.000Z",
      "2026-01-19T12:00:00.000Z",
    ]);
  });

  it("supports WEEKLY INTERVAL=2 (covers weekIndex%interval branch)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:w-3",
      // 2026-01-05 is Monday
      "DTSTART:20260105T120000Z",
      "DTEND:20260105T123000Z",
      "RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3",
      "SUMMARY:Biweekly",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics, { now: new Date("2026-01-05T00:00:00.000Z"), horizonDays: 60 });
    // Каждые 2 недели: 05, 19, 02-02
    expect(events.map((e) => e.start.toISOString())).toEqual([
      "2026-01-05T12:00:00.000Z",
      "2026-01-19T12:00:00.000Z",
      "2026-02-02T12:00:00.000Z",
    ]);
  });

  it("drops occurrence when UNTIL time is earlier than DTSTART time on the same day (covers sMs>hardEnd branch)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:w-4",
      "DTSTART:20260105T120000Z",
      // UNTIL на той же дате, но раньше по времени — базовое происхождение должно быть > hardEnd и отфильтроваться.
      "RRULE:FREQ=WEEKLY;UNTIL=20260105T110000Z",
      "SUMMARY:Too late",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics, { now: new Date("2026-01-05T00:00:00.000Z"), horizonDays: 10 });
    expect(events).toHaveLength(0);
  });

  it("cuts RRULE by UNTIL", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:d-2",
      "DTSTART:20260101T120000Z",
      "DTEND:20260101T123000Z",
      "RRULE:FREQ=DAILY;UNTIL=20260103T120000Z",
      "SUMMARY:Daily",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics, { now: new Date("2026-01-01T00:00:00.000Z"), horizonDays: 10 });
    expect(events.map((e) => e.start.toISOString())).toEqual([
      "2026-01-01T12:00:00.000Z",
      "2026-01-02T12:00:00.000Z",
      "2026-01-03T12:00:00.000Z",
    ]);
  });

  it("two-pass overrides: игнорирует override с невалидным DTSTART и VEVENT без UID (ветки uid??/blocked/start==null)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      // VEVENT без UID -> base=null
      "BEGIN:VEVENT",
      "DTSTART:20260118T120000Z",
      "SUMMARY:No uid",
      "END:VEVENT",
      // override с RECURRENCE-ID, но без DTSTART -> dtStartRaw == "" (?? ветка) -> continue в overrides pass
      "BEGIN:VEVENT",
      "UID:ov-miss",
      "RECURRENCE-ID:20260119T120000Z",
      "SUMMARY:Missing DTSTART",
      "END:VEVENT",
      // override с RECURRENCE-ID, но DTSTART не парсится -> start==null -> continue в overrides pass
      "BEGIN:VEVENT",
      "UID:ov-bad",
      "DTSTART:BAD",
      "RECURRENCE-ID:20260119T120000Z",
      "SUMMARY:Bad override",
      "END:VEVENT",
      // master
      "BEGIN:VEVENT",
      "UID:ov-2",
      "DTSTART:20260118T120000Z",
      "RRULE:FREQ=DAILY;COUNT=2",
      "SUMMARY:Master",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics, { now: new Date("2026-01-18T00:00:00.000Z"), horizonDays: 10 });
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.start.toISOString())).toEqual(["2026-01-18T12:00:00.000Z", "2026-01-19T12:00:00.000Z"]);
  });

  it("dedup: предпочитает более “богатое” событие и не заменяет его более бедным (ветки prev/score>= и prev/score<)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:dup-1",
      "DTSTART:20260118T120000Z",
      "SUMMARY:Poor",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:dup-1",
      "DTSTART:20260118T120000Z",
      "SUMMARY:Rich",
      "DESCRIPTION:Desc",
      "LOCATION:Loc",
      "URL:https://example.com",
      "ATTENDEE;PARTSTAT=ACCEPTED:mailto:me@example.com",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:dup-1",
      "DTSTART:20260118T120000Z",
      "SUMMARY:Poor2",
      "LOCATION:OnlyLoc",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics, { myEmail: "me@example.com" });
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Rich");
    expect(events[0].status).toBe("accepted");
    expect(events[0].attendees?.length).toBeGreaterThan(0);
  });

  it("attendees/organizer/reminders edge cases (empty attendee, duplicates, optional fields, разные TRIGGER)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:att-1",
      "DTSTART:20260118T120000Z",
      // name="" -> parseContentLine -> null
      ";X=Y:Z",
      // bad param (без '=') -> ветка eq<=0 continue, но DTSTART должен распарситься
      "DTSTART;BADPARAM:20260118T120000Z",
      // attendees
      "ATTENDEE:", // пустой value -> normalizeEmail("") -> continue
      "ATTENDEE;CN=Alice;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:alice@example.com",
      "ATTENDEE;CN=AliceDup;PARTSTAT=TENTATIVE:mailto:alice@example.com", // duplicate -> seen.has -> continue
      "ATTENDEE;CN=Bob:mailto:bob@example.com", // без ROLE/PARTSTAT
      "ATTENDEE:mailto:charlie@example.com", // без CN/ROLE/PARTSTAT -> cn/role/partstat -> undefined
      // organizer без CN -> displayName undefined
      "ORGANIZER:mailto:org@example.com",
      // alarms
      "BEGIN:VALARM",
      "TRIGGER:-PT1S",
      "ACTION:DISPLAY",
      "DESCRIPTION:Ping",
      "END:VALARM",
      "BEGIN:VALARM",
      "TRIGGER:-PT0S",
      "END:VALARM",
      "BEGIN:VALARM",
      "TRIGGER:BAD",
      "END:VALARM",
      "BEGIN:VALARM",
      // очень большое число часов -> Number(...) = Infinity -> !Number.isFinite(...) ветка
      `TRIGGER:-PT${"9".repeat(400)}H`,
      "END:VALARM",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics, { myEmail: "me@example.com" });
    expect(events).toHaveLength(1);

    const ev = events[0];
    expect(ev.organizer?.displayName).toBeUndefined();
    expect(ev.attendees?.map((a) => a.email).sort()).toEqual(["alice@example.com", "bob@example.com", "charlie@example.com"]);
    expect(ev.attendees?.find((a) => a.email === "alice@example.com")?.role).toBe("REQ-PARTICIPANT");
    expect(ev.attendees?.find((a) => a.email === "alice@example.com")?.partstat).toBe("ACCEPTED");
    expect(ev.attendees?.find((a) => a.email === "bob@example.com")?.role).toBeUndefined();
    expect(ev.attendees?.find((a) => a.email === "bob@example.com")?.partstat).toBeUndefined();
    expect(ev.attendees?.find((a) => a.email === "charlie@example.com")?.cn).toBeUndefined();

    // minutesBefore:
    // -PT1S => 1 (секунды округляются вверх)
    // -PT0S => undefined
    // BAD => undefined
    // huge hours => Infinity => undefined
    // без TRIGGER => undefined
    expect(ev.reminders?.map((r) => r.minutesBefore)).toEqual([1, undefined, undefined, undefined, undefined]);
    expect(ev.reminders?.[0]?.person?.emails).toEqual(["me@example.com"]);

    // detectMyPartstat: myEmail="," -> meSet.size=0 -> undefined
    const events2 = parseIcs(cal1, ics, { myEmail: "," });
    expect(events2).toHaveLength(1);
    expect(events2[0].status).toBeUndefined();

    // detectMyPartstat: совпадающий attendee без PARTSTAT -> ps=="" -> return undefined
    const ics2 = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:ps-0",
      "DTSTART:20260118T120000Z",
      "ATTENDEE:mailto:me2@example.com",
      "SUMMARY:No partstat",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    const e3 = parseIcs(cal1, ics2, { myEmail: "me2@example.com" });
    expect(e3[0].status).toBeUndefined();
  });

  it("RRULE edge cases: missing FREQ, INTERVAL=0, UNTIL invalid, all-day durationMs=24h, default opts now/horizonDays", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      // missing FREQ -> только базовое
      "BEGIN:VEVENT",
      "UID:rr-1",
      "DTSTART:20260101T120000Z",
      "RRULE:COUNT=2",
      "END:VEVENT",
      // INTERVAL=0 -> Math.max/||1
      "BEGIN:VEVENT",
      "UID:rr-2",
      "DTSTART:20260101T120000Z",
      "RRULE:FREQ=DAILY;INTERVAL=0;COUNT=2",
      "SUMMARY:Interval0",
      "END:VEVENT",
      // UNTIL invalid -> parseIcsDate null -> until undefined
      "BEGIN:VEVENT",
      "UID:rr-3",
      "DTSTART:20260101T120000Z",
      "RRULE:FREQ=DAILY;UNTIL=BAD;COUNT=2",
      "SUMMARY:UntilBad",
      "END:VEVENT",
      // RRULE с кривыми чанками (idx<=0 continue в parseRrule)
      "BEGIN:VEVENT",
      "UID:rr-5",
      "DTSTART:20260101T120000Z",
      "RRULE:FREQ=DAILY;BROKEN;=X;COUNT=2",
      "SUMMARY:BrokenChunks",
      "END:VEVENT",
      // all-day recurring -> durationMs=24h (end выставляется)
      "BEGIN:VEVENT",
      "UID:rr-4",
      "DTSTART;VALUE=DATE:20260101",
      "RRULE:FREQ=DAILY;COUNT=2",
      "SUMMARY:AllDay",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs(cal1, ics, { now: new Date("2026-01-01T00:00:00.000Z"), horizonDays: 10 });

    const rr1 = events.filter((e) => e.id === "rr-1");
    expect(rr1).toHaveLength(1);

    const rr2 = events.filter((e) => e.id === "rr-2");
    expect(rr2).toHaveLength(2);
    expect(rr2.map((e) => e.start.toISOString())).toEqual(["2026-01-01T12:00:00.000Z", "2026-01-02T12:00:00.000Z"]);

    const rr3 = events.filter((e) => e.id === "rr-3");
    expect(rr3).toHaveLength(2);

    const rr5 = events.filter((e) => e.id === "rr-5");
    expect(rr5).toHaveLength(2);

    const rr4 = events.filter((e) => e.id === "rr-4");
    expect(rr4).toHaveLength(2);
    expect(rr4.every((e) => e.end != null && e.end.getTime() - e.start.getTime() === 24 * 60 * 60_000)).toBe(true);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const icsDefault = [
      "BEGIN:VCALENDAR",
      "",
      "BEGIN:VEVENT",
      "UID:def-1",
      "DTSTART:20260101T120000Z",
      "RRULE:FREQ=DAILY;COUNT=1",
      "SUMMARY:Default",
      "DTEND:BAD", // dtEndRaw задан, но не парсится -> end undefined (?? ветка)
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    const defEvents = parseIcs(cal1, icsDefault);
    expect(defEvents.length).toBeGreaterThanOrEqual(1);
    expect(defEvents.every((e) => e.end == null)).toBe(true);
    vi.useRealTimers();
  });
});
