import type { Plugin } from "obsidian";

export type AssistantCommandActions = {
  openAgenda: () => void;
  openRecordingDialog: () => void;
  openLog: () => void;
  refreshCalendars: () => void;
  createMeetingCard: () => void;
  createProtocolCard: () => void;
  createProtocolFromOpenMeeting: () => void;
  createPersonCard: () => void;
  createProjectCard: () => void;
  createPeopleFromAttendees: () => void;
  applyOutbox: () => void;
  eventStatusAccepted: () => void;
  eventStatusDeclined: () => void;
  eventStatusTentative: () => void;
  eventStatusNeedsAction: () => void;
  applyStatusFromMeetingNote: () => void;
  createProtocolFromActiveEvent: () => void;
};

/**
 * Регистрация команд Obsidian (Command Palette).
 *
 * Важно: модуль не знает про `AssistantPlugin` и не трогает приватные методы.
 * Все действия прокидываются через `actions`.
 */
export function registerAssistantCommands(plugin: Plugin, actions: AssistantCommandActions): void {

  plugin.addCommand({ id: "open-agenda", name: "Открыть повестку", callback: actions.openAgenda });

  plugin.addCommand({ id: "recording-open-dialog", name: "Диктофон", callback: actions.openRecordingDialog });

  plugin.addCommand({ id: "open-log", name: "Открыть лог", callback: actions.openLog });

  plugin.addCommand({ id: "refresh-calendars", name: "Обновить календари", callback: actions.refreshCalendars });

  plugin.addCommand({ id: "create-meeting-card", name: "Создать карточку встречи", callback: actions.createMeetingCard });

  plugin.addCommand({ id: "create-protocol-card", name: "Создать карточку протокола", callback: actions.createProtocolCard });

  plugin.addCommand({ id: "create-protocol-from-open-meeting", name: "Создать протокол из открытой карточки", callback: actions.createProtocolFromOpenMeeting });

  plugin.addCommand({ id: "create-person-card", name: "Создать карточку человека", callback: actions.createPersonCard });

  plugin.addCommand({ id: "create-project-card", name: "Создать карточку проекта", callback: actions.createProjectCard });

  plugin.addCommand({ id: "meeting-create-people-from-attendees", name: "Создать карточки людей из участников", callback: actions.createPeopleFromAttendees });

  plugin.addCommand({ id: "apply-outbox", name: "Применить офлайн-очередь", callback: actions.applyOutbox });

  plugin.addCommand({ id: "event-status-accepted", name: "Принято (в календаре, из заметки встречи)", callback: actions.eventStatusAccepted });
  plugin.addCommand({ id: "event-status-declined", name: "Отклонено (в календаре, из заметки встречи)", callback: actions.eventStatusDeclined });
  plugin.addCommand({ id: "event-status-tentative", name: "Возможно (в календаре, из заметки встречи)", callback: actions.eventStatusTentative });
  plugin.addCommand({ id: "event-status-needs-action", name: "Нет ответа (в календаре, из заметки встречи)", callback: actions.eventStatusNeedsAction });

  plugin.addCommand({ id: "meeting-apply-status-from-note", name: "Применить статус из заметки в календарь", callback: actions.applyStatusFromMeetingNote});

  plugin.addCommand({ id: "create-meeting-from-active-event", name: "Создать протокол из текущей встречи", callback: actions.createProtocolFromActiveEvent });
}

