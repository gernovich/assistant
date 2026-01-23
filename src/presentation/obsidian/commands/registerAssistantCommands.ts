import type { CommandsController } from "../../controllers/commandsController";
import type { PluginPort } from "../obsidianPorts";

/**
 * Регистрация команд Obsidian (Command Palette).
 *
 * Важно: модуль не знает про `AssistantPlugin` и не трогает приватные методы.
 * Все действия прокидываются через `CommandsController`.
 */
export function registerAssistantCommands(plugin: PluginPort, c: CommandsController): void {

  plugin.addCommand({ id: "open-agenda", name: "Открыть повестку", callback: () => c.openAgenda() });

  plugin.addCommand({ id: "recording-open-dialog", name: "Диктофон", callback: () => c.openRecordingDialog() });

  plugin.addCommand({ id: "open-log", name: "Открыть лог", callback: () => c.openLog() });

  plugin.addCommand({ id: "refresh-calendars", name: "Обновить календари", callback: () => c.refreshCalendars() });

  plugin.addCommand({ id: "create-meeting-card", name: "Создать карточку встречи", callback: () => c.createMeetingCard() });

  plugin.addCommand({ id: "create-protocol-card", name: "Создать карточку протокола", callback: () => c.createProtocolCard() });

  plugin.addCommand({
    id: "create-protocol-from-open-meeting",
    name: "Создать протокол из открытой карточки",
    callback: () => c.createProtocolFromOpenMeeting(),
  });

  plugin.addCommand({ id: "create-person-card", name: "Создать карточку человека", callback: () => c.createPersonCard() });

  plugin.addCommand({ id: "create-project-card", name: "Создать карточку проекта", callback: () => c.createProjectCard() });

  plugin.addCommand({
    id: "meeting-create-people-from-attendees",
    name: "Создать карточки людей из участников",
    callback: () => c.createPeopleFromAttendees(),
  });

  plugin.addCommand({ id: "apply-outbox", name: "Применить офлайн-очередь", callback: () => c.applyOutbox() });

  plugin.addCommand({ id: "event-status-accepted", name: "Принято (в календаре, из заметки встречи)", callback: () => c.eventStatusAccepted() });
  plugin.addCommand({ id: "event-status-declined", name: "Отклонено (в календаре, из заметки встречи)", callback: () => c.eventStatusDeclined() });
  plugin.addCommand({ id: "event-status-tentative", name: "Возможно (в календаре, из заметки встречи)", callback: () => c.eventStatusTentative() });
  plugin.addCommand({ id: "event-status-needs-action", name: "Нет ответа (в календаре, из заметки встречи)", callback: () => c.eventStatusNeedsAction() });

  plugin.addCommand({
    id: "meeting-apply-status-from-note",
    name: "Применить статус из заметки в календарь",
    callback: () => c.applyStatusFromMeetingNote(),
  });

  plugin.addCommand({
    id: "create-meeting-from-active-event",
    name: "Создать протокол из текущей встречи",
    callback: () => c.createProtocolFromActiveEvent(),
  });
}

