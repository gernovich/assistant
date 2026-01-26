import type { Event } from "../../types";
import { stripMarkdownExtension } from "./wikiLink";

/**
 * Политика: шаблон протокола (markdown).
 *
 * Чистая функция: всё “инфраструктурное” (escape/keys) — через параметры.
 */
export function renderProtocolMarkdown(params: {
  ev: Event;
  eventFilePath?: string;
  keys: {
    assistantType: string;
    protocolId: string;
    calendarId: string;
    start: string;
    end: string;
    summary: string;
    transcript: string;
    files: string;
    participants: string;
    projects: string;
  };
  escape: (s: string) => string;
  makeEventKey: (calendarId: string, eventId: string) => string;
}): string {
  const startIso = params.ev.start.toISOString();
  const endIso = params.ev.end ? params.ev.end.toISOString() : "";
  const eventKey = params.makeEventKey(params.ev.calendar.id, params.ev.id);
  const eventLinkTarget = params.eventFilePath ? stripMarkdownExtension(params.eventFilePath) : "";

  return [
    "---",
    `${params.keys.assistantType}: protocol`,
    `${params.keys.protocolId}: ${params.escape(eventKey)}`,
    `${params.keys.calendarId}: ${params.escape(params.ev.calendar.id)}`,
    `${params.keys.start}: ${params.escape(startIso)}`,
    `${params.keys.end}: ${params.escape(endIso)}`,
    `${params.keys.summary}: `,
    `${params.keys.transcript}: `,
    `${params.keys.files}: []`,
    `${params.keys.participants}: []`,
    `${params.keys.projects}: []`,
    "---",
    "",
    `## ${params.ev.summary}`,
    "",
    "### Встреча (календарь)",
    "",
    eventLinkTarget ? `- [[${eventLinkTarget}|Встреча]]` : "- [[Встреча]]",
    "",
    "### Расшифровка",
    "",
    "- (вставь транскрипт сюда)",
    "",
    "### Ссылки",
    "",
    params.ev.url ? `- Ссылка: ${params.ev.url}` : "- Ссылка: ",
    "",
    "### Запись",
    "",
    "- Файл записи: ",
    "",
    "### Транскрипт",
    "",
    "- (пока пусто)",
    "",
    "### Саммари",
    "",
    "- Короткое: ",
    "- Для календаря: ",
    "- Расширенное: ",
    "",
    "### Окраска",
    "",
    "- (пока пусто)",
    "",
    "### Факты / обещания / задачи",
    "",
    "- (пока пусто)",
    "",
    "### Люди",
    "",
    "- (пока пусто)",
    "",
    "### Проекты",
    "",
    "- (пока пусто)",
    "",
  ].join("\n");
}

export function renderEmptyProtocolMarkdown(params: {
  id: string;
  startIso: string;
  keys: {
    assistantType: string;
    protocolId: string;
    calendarId: string;
    start: string;
    end: string;
    summary: string;
    transcript: string;
    files: string;
    participants: string;
    projects: string;
  };
  escape: (s: string) => string;
}): string {
  return [
    "---",
    `${params.keys.assistantType}: protocol`,
    `${params.keys.protocolId}: ${params.escape(params.id)}`,
    `${params.keys.calendarId}: ${params.escape("manual")}`,
    `${params.keys.start}: ${params.escape(params.startIso)}`,
    `${params.keys.end}: `,
    `${params.keys.summary}: `,
    `${params.keys.transcript}: `,
    `${params.keys.files}: []`,
    `${params.keys.participants}: []`,
    `${params.keys.projects}: []`,
    "---",
    "",
    "## Протокол",
    "",
    "### Встреча (карточка)",
    "",
    "- [[Встреча]]",
    "",
    "### Расшифровка",
    "",
    "- (вставь транскрипт сюда)",
    "",
    "### Саммари",
    "",
    "- Короткое: ",
    "- Для календаря: ",
    "- Расширенное: ",
    "",
    "### Факты / обещания / задачи",
    "",
    "- (пока пусто)",
    "",
    "### Люди",
    "",
    "- (пока пусто)",
    "",
    "### Проекты",
    "",
    "- (пока пусто)",
    "",
  ].join("\n");
}
