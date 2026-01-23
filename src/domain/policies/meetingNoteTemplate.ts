import type { MeetingFrontmatterData } from "./meetingFrontmatterData";
import { yamlStringArrayLines } from "./frontmatterYaml";

/**
 * Policy: шаблон карточки встречи (markdown).
 *
 * Важно: чистая функция. Все инфраструктурные детали передаются параметрами (escape/keys/renderers).
 */
export function renderMeetingNoteMarkdown(params: {
  fm: MeetingFrontmatterData;
  description?: string;
  attendeesMarkdown: string;
  includeUserSections: boolean;
  keys: {
    assistantType: string;
    calendarId: string;
    eventId: string;
    summary: string;
    start: string;
    end: string;
    url: string;
    location: string;
    status: string;
    organizerEmail: string;
    organizerCn: string;
    attendees: string;
    attendeesAccepted: string;
    attendeesDeclined: string;
    attendeesTentative: string;
    attendeesNeedsAction: string;
    attendeesUnknown: string;
  };
  escape: (s: string) => string;
}): string {
  const { fm, keys, escape } = params;

  const attendeesFrontmatter = [
    ...yamlStringArrayLines({ key: keys.attendeesAccepted, values: fm.attendeesAccepted, escape }),
    ...yamlStringArrayLines({ key: keys.attendeesDeclined, values: fm.attendeesDeclined, escape }),
    ...yamlStringArrayLines({ key: keys.attendeesTentative, values: fm.attendeesTentative, escape }),
    ...yamlStringArrayLines({ key: keys.attendeesNeedsAction, values: fm.attendeesNeedsAction, escape }),
    ...yamlStringArrayLines({ key: keys.attendeesUnknown, values: fm.attendeesUnknown, escape }),
    ...yamlStringArrayLines({ key: keys.attendees, values: fm.attendeesAll, escape }),
  ];

  const header = [
    "---",
    `${keys.assistantType}: calendar_event`,
    `${keys.calendarId}: ${escape(fm.calendarId)}`,
    `${keys.eventId}: ${escape(fm.eventId)}`,
    `${keys.summary}: ${escape(fm.summary)}`,
    `${keys.start}: ${escape(fm.startIso)}`,
    `${keys.end}: ${escape(fm.endIso)}`,
    fm.timezone ? `timezone: ${escape(fm.timezone)}` : "",
    fm.rrule ? `rrule: ${escape(fm.rrule)}` : "",
    fm.remindersMinutesBefore?.length ? `reminders_minutes_before: [${fm.remindersMinutesBefore.join(", ")}]` : "",
    fm.eventColor ? `event_color: ${escape(fm.eventColor)}` : "",
    fm.status ? `${keys.status}: ${escape(fm.status)}` : "",
    fm.organizerEmail ? `${keys.organizerEmail}: ${escape(fm.organizerEmail)}` : "",
    fm.organizerCn ? `${keys.organizerCn}: ${escape(fm.organizerCn)}` : "",
    ...attendeesFrontmatter,
    fm.url ? `${keys.url}: ${escape(fm.url)}` : "",
    fm.location ? `${keys.location}: ${escape(fm.location)}` : "",
    "---",
    "",
    `## ${fm.summary}`,
    "",
    `- Начало: ${fm.startIso}`,
    fm.endIso ? `- Конец: ${fm.endIso}` : "",
    fm.url ? `- Ссылка: ${fm.url}` : "",
    fm.location ? `- Место: ${fm.location}` : "",
    "",
    params.description ? `## Описание\n\n${params.description}\n` : "",
    "## Участники",
    "",
    params.attendeesMarkdown,
    "",
    "## Протоколы",
    "<!-- ASSISTANT:PROTOCOLS -->",
  ]
    .filter(Boolean)
    .join("\n");

  const base = header.endsWith("\n") ? header : header + "\n";
  if (!params.includeUserSections) return base;
  return base + ["", "- (пока пусто)", "", "## Заметки", "", "<!-- ASSISTANT:USER -->", ""].join("\n");
}
