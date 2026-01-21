import { describe, expect, it } from "vitest";
import { parseIcs } from "../src/calendar/ics";
import type { Calendar } from "../src/types";

const cal1: Calendar = {
  id: "cal1",
  name: "cal1",
  type: "ics_url",
  config: { id: "cal1", name: "cal1", type: "ics_url", enabled: true },
};

describe("parseIcs", () => {
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
});
