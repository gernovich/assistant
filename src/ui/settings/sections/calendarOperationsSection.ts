import { Setting } from "obsidian";
import type AssistantPlugin from "../../../../main";

/** Отрисовать секцию настроек: Операции с календарями. */
export function renderCalendarOperationsSection(params: { containerEl: HTMLElement; plugin: AssistantPlugin }): void {
  const { containerEl, plugin } = params;

  containerEl.createEl("h3", { text: "Операции с календарями" });

  new Setting(containerEl)
    .setName("Обновить календари")
    .setDesc("Скачать встречи заново.")
    .addButton((b) =>
      b.setButtonText("Обновить").onClick(async () => {
        await plugin.settingsOps.refreshCalendars();
      }),
    );
}
