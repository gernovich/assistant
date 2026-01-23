/**
 * CommandsController — узкий порт для команд Obsidian (Command Palette).
 *
 * Зачем: `registerAssistantCommands` не должен принимать “жирный” bundle коллбеков и
 * не должен знать про orchestration. Все действия инкапсулируем в одном контроллере.
 */
export interface CommandsController {
  openAgenda(): void;
  openRecordingDialog(): void;
  openLog(): void;
  refreshCalendars(): void;
  createMeetingCard(): void;
  createProtocolCard(): void;
  createProtocolFromOpenMeeting(): void;
  createPersonCard(): void;
  createProjectCard(): void;
  createPeopleFromAttendees(): void;
  applyOutbox(): void;
  eventStatusAccepted(): void;
  eventStatusDeclined(): void;
  eventStatusTentative(): void;
  eventStatusNeedsAction(): void;
  applyStatusFromMeetingNote(): void;
  createProtocolFromActiveEvent(): void;
}

