import { describe, expect, it } from "vitest";
import { buildMeetingFrontmatterData } from "../../src/domain/policies/meetingFrontmatterData";
import type { Calendar, Event } from "../../src/types";

function cal(id: string): Calendar {
  return { id, name: id, type: "ics_url", config: { id, name: id, type: "ics_url", enabled: true } };
}

describe("domain/policies/meetingFrontmatterData", () => {
  it("строит базовые поля + attendees группировки + organizer/reminders", () => {
    const ev: Event = {
      calendar: cal("calA"),
      id: "uid1",
      summary: "Meet",
      start: new Date("2026-01-01T10:00:00.000Z"),
      end: new Date("2026-01-01T11:00:00.000Z"),
      organizer: { id: "p1", displayName: "Org", emails: ["org@x.com"] },
      attendees: [
        { email: "a@x.com", partstat: "ACCEPTED" },
        { email: "b@x.com", partstat: "DECLINED" },
      ],
      reminders: [{ minutesBefore: 5, status: "planned", person: { id: "p2" } as any }],
      color: { value: "#fff" } as any,
      status: "accepted",
      location: "L",
      url: "U",
    };

    const fm = buildMeetingFrontmatterData(ev);
    expect(fm.calendarId).toBe("calA");
    expect(fm.eventId).toBe("uid1");
    expect(fm.organizerEmail).toBe("org@x.com");
    expect(fm.remindersMinutesBefore).toEqual([5]);
    expect(fm.attendeesAll.length).toBe(2);
    expect(fm.attendeesAccepted.length).toBe(1);
    expect(fm.attendeesDeclined.length).toBe(1);
    expect(fm.eventColor).toBe("#fff");
  });
});
