import type { AssistantEntityType } from "../../types";

/**
 * Policy: единый словарь ключей frontmatter.
 *
 * Чистое: только константы/предикаты. Вынесено из vault.
 */
export const FM = {
  assistantType: "assistant_type",

  // -----------------------------------------------------------------------------
  // IDs
  // -----------------------------------------------------------------------------
  eventId: "event_id",
  calendarId: "calendar_id",

  protocolId: "protocol_id",
  personId: "person_id",
  projectId: "project_id",

  // meeting/event note
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

  // protocol note
  transcript: "transcript",
  files: "files",
  participants: "participants",
  projects: "projects",

  // person note
  displayName: "display_name",
  firstName: "first_name",
  lastName: "last_name",
  middleName: "middle_name",
  nickName: "nick_name",
  gender: "gender",
  photo: "photo",
  birthday: "birthday",
  voiceprint: "voiceprint",
  mailboxes: "mailboxes",
  emails: "emails",
  phones: "phones",
  companies: "companies",
  positions: "positions",
  messengers: "messengers",

  // project note
  owner: "owner",
  tags: "tags",
  protocols: "protocols",
} as const;

export function isAssistantEntityType(x: unknown): x is AssistantEntityType {
  return x === "calendar_event" || x === "protocol" || x === "person" || x === "project";
}
