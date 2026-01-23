import { Setting } from "obsidian";
import type AssistantPlugin from "../../../../main";

/** Отрисовать секцию настроек: Отладка. */
export function renderDebugSection(params: {
  containerEl: HTMLElement;
  plugin: AssistantPlugin;
  rerenderPreservingScroll: () => void;
}): void {
  const { containerEl, plugin } = params;

  containerEl.createEl("h3", { text: "Отладка" });

  new Setting(containerEl)
    .setName("Включить отладку")
    .setDesc("Показывает дополнительные элементы: кнопки/панель лога, debug-опции в UI.")
    .addToggle((t) =>
      t.setValue(plugin.settings.debug.enabled).onChange(async (v) => {
        await plugin.applySettingsCommand({ type: "debug.update", enabled: v });
        params.rerenderPreservingScroll();
      }),
    );
}
