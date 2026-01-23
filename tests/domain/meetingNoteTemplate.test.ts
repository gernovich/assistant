import { describe, expect, it } from "vitest";
import { renderMeetingNoteMarkdown } from "../../src/domain/policies/meetingNoteTemplate";

describe("domain/policies/meetingNoteTemplate", () => {
  it("рендерит базовую карточку встречи (без user sections)", () => {
    const md = renderMeetingNoteMarkdown({
      fm: {
        assistantType: "calendar_event",
        calendarId: "calA",
        eventId: "uid1",
        summary: "Meet",
        startIso: "2026-01-01T10:00:00.000Z",
        endIso: "2026-01-01T11:00:00.000Z",
        attendeesAll: [],
        attendeesAccepted: [],
        attendeesDeclined: [],
        attendeesTentative: [],
        attendeesNeedsAction: [],
        attendeesUnknown: [],
      },
      description: "Desc",
      attendeesMarkdown: "- a@x.com — не указал",
      includeUserSections: false,
      keys: {
        assistantType: "assistant_type",
        calendarId: "calendar_id",
        eventId: "event_id",
        summary: "summary",
        start: "start",
        end: "end",
        url: "url",
        location: "location",
        status: "status",
        organizerEmail: "organizer_email",
        organizerCn: "organizer_cn",
        attendees: "attendees",
        attendeesAccepted: "attendees_accepted",
        attendeesDeclined: "attendees_declined",
        attendeesTentative: "attendees_tentative",
        attendeesNeedsAction: "attendees_needs_action",
        attendeesUnknown: "attendees_unknown",
      },
      escape: (s) => s,
    });

    expect(md).toContain("assistant_type: calendar_event");
    expect(md).toContain("calendar_id: calA");
    expect(md).toContain("event_id: uid1");
    expect(md).toContain("## Meet");
    expect(md).toContain("## Описание");
    expect(md).toContain("## Участники");
    expect(md).toContain("<!-- ASSISTANT:PROTOCOLS -->");
  });
});
