import type { AgendaController } from "../../../application/agenda/agendaController";
import { AgendaView, AGENDA_VIEW_TYPE } from "../../../views/agendaView";
import { LOG_VIEW_TYPE, LogView } from "../../../views/logView";
import { TEST_TRANSPORT_VIEW_TYPE, TestTransportView } from "../../../views/testTransportView";
import type { AssistantSettings } from "../../../types";
import type { LogController } from "../../controllers/logController";
import type { TestTransportController } from "../../controllers/testTransportController";
import type { PluginPort } from "../obsidianPorts";

export type AssistantViewsDeps = {
  settings: AssistantSettings;
};

export type AssistantViewsControllers = {
  createAgendaController: () => AgendaController;
  createLogController: () => LogController;
  createTestTransportController: () => TestTransportController;
};

/**
 * Регистрация Obsidian views (повестка/лог).
 *
 * Важно: модуль не знает про `AssistantPlugin` и не лезет в приватные методы.
 */
export function registerAssistantViews(plugin: PluginPort, deps: AssistantViewsDeps, c: AssistantViewsControllers): void {
  plugin.registerView(AGENDA_VIEW_TYPE, (leaf: any) => new AgendaView(leaf, deps.settings, c.createAgendaController()));

  plugin.registerView(LOG_VIEW_TYPE, (leaf: any) => new LogView(leaf, c.createLogController()));

  plugin.registerView(TEST_TRANSPORT_VIEW_TYPE, (leaf: any) => new TestTransportView(leaf, c.createTestTransportController()));
}
