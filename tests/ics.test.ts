import { describe, expect, it } from "vitest";
import { parseIcs } from "../src/calendar/ics";

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

    const events = parseIcs("cal1", ics);
    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe("abc-123");
    expect(events[0].summary).toBe("Test event");
    expect(events[0].description).toBe("Line1\nLine2");
    expect(events[0].location).toBe("Office");
    expect(events[0].url).toBe("https://example.com/meet");
    expect(events[0].start.toISOString()).toBe("2026-01-18T12:00:00.000Z");
    expect(events[0].end?.toISOString()).toBe("2026-01-18T12:30:00.000Z");
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

    const events = parseIcs("cal1", ics);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Long summary that iscontinued");
  });

  it("parses all-day date format", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:day-1",
      "DTSTART:20260118",
      "SUMMARY:All day",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const events = parseIcs("cal1", ics);
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

    const events = parseIcs("cal1", ics, { now: new Date("2026-01-18T00:00:00.000Z"), horizonDays: 10 });
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.start.toISOString())).toEqual([
      "2026-01-18T12:00:00.000Z",
      "2026-01-19T12:00:00.000Z",
      "2026-01-20T12:00:00.000Z",
    ]);
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

    const events = parseIcs("cal1", ics, { myEmail: "me@example.com" });
    expect(events).toHaveLength(1);
    expect(events[0].myPartstat).toBe("accepted");
  });
});

