import type { Plugin, WorkspaceLeaf } from "obsidian";
import { AgendaView, AGENDA_VIEW_TYPE } from "../../../views/agendaView";
import { LOG_VIEW_TYPE, LogView } from "../../../views/logView";
import type { AssistantSettings, Event } from "../../../types";
import type { CalendarService } from "../../../calendar/calendarService";
import type { LogService } from "../../../log/logService";

export type AssistantViewsDeps = {
  settings: AssistantSettings;
  calendarService: CalendarService;
  logService: LogService;
};

export type AssistantViewsActions = {
  openLog: () => void;
  openAgenda: () => void;
  openEvent: (ev: Event) => void;
  setMyPartstat: (ev: Event, partstat: NonNullable<Event["status"]>) => Promise<void> | void;
  getProtocolMenuState: (ev: Event) => Promise<{ hasCurrent: boolean; hasLatest: boolean; currentIsLatest: boolean }>;
  openCurrentProtocol: (ev: Event) => void | Promise<void>;
  openLatestProtocol: (ev: Event) => void | Promise<void>;
  createProtocol: (ev: Event) => unknown | Promise<unknown>;
  openRecorder: (ev: Event) => void | Promise<void>;
  debugShowReminder: (ev: Event) => void;
  openTodayLog: () => void;
  clearTodayLogFile: () => void;
};

/**
 * Регистрация Obsidian views (повестка/лог).
 *
 * Важно: модуль не знает про `AssistantPlugin` и не лезет в приватные методы.
 */
export function registerAssistantViews(plugin: Plugin, deps: AssistantViewsDeps, actions: AssistantViewsActions): void {
  plugin.registerView(
    AGENDA_VIEW_TYPE,
    (leaf: WorkspaceLeaf) =>
      new AgendaView(
        leaf,
        deps.settings,
        deps.calendarService,
        actions.openLog,
        actions.openEvent,
        actions.setMyPartstat,
        actions.getProtocolMenuState,
        actions.openCurrentProtocol,
        actions.openLatestProtocol,
        actions.createProtocol,
        actions.openRecorder,
        actions.debugShowReminder,
      ),
  );

  plugin.registerView(
    LOG_VIEW_TYPE,
    (leaf: WorkspaceLeaf) =>
      new LogView(leaf, deps.logService, actions.openTodayLog, actions.clearTodayLogFile, actions.openAgenda),
  );
}

