import { describe, expect, it } from "vitest";
import { updateMyAttendeePartstatInIcal } from "../src/calendar/providers/caldavProvider";

describe("updateMyAttendeePartstatInIcal", () => {
  it("обновляет PARTSTAT в существующем ATTENDEE для моего email", () => {
    const ical = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:1",
      "DTSTART:20260101T100000Z",
      "ATTENDEE;CN=Me;PARTSTAT=NEEDS-ACTION:mailto:me@example.com",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\n");

    const out = updateMyAttendeePartstatInIcal(ical, ["me@example.com"], "DECLINED");
    expect(out).toContain("ATTENDEE;CN=Me;PARTSTAT=DECLINED:mailto:me@example.com");
  });

  it("если ATTENDEE отсутствует, но я ORGANIZER — добавляет ATTENDEE и ставит PARTSTAT", () => {
    const ical = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:1",
      "DTSTART:20260101T100000Z",
      "ORGANIZER:mailto:me@example.com",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\n");

    const out = updateMyAttendeePartstatInIcal(ical, ["me@example.com"], "ACCEPTED");
    expect(out).toContain("ORGANIZER:mailto:me@example.com");
    expect(out).toContain("ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:me@example.com");
  });

  it("если я не найден ни в ATTENDEE ни в ORGANIZER — ничего не меняет", () => {
    const ical = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:1",
      "DTSTART:20260101T100000Z",
      "ORGANIZER:mailto:owner@example.com",
      "ATTENDEE;CN=Other;PARTSTAT=ACCEPTED:mailto:other@example.com",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\n");

    const out = updateMyAttendeePartstatInIcal(ical, ["me@example.com"], "DECLINED");
    expect(out).toBe(ical);
  });
});

