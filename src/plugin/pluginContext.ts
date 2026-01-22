import type { App } from "obsidian";
import type AssistantPlugin from "../../main";

/**
 * Composition Root (ручной DI) для плагина.
 *
 * На Этапе 0 этот контекст НЕ подключается к runtime — это заготовка,
 * чтобы дальше выносить wiring из `main.ts` маленькими шагами.
 */
export type PluginContext = {
  app: App;
  plugin: AssistantPlugin;
};

export function createPluginContext(params: { app: App; plugin: AssistantPlugin }): PluginContext {
  return { app: params.app, plugin: params.plugin };
}

