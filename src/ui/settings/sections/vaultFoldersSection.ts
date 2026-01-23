import { Setting } from "obsidian";
import type AssistantPlugin from "../../../../main";

/** Отрисовать секцию настроек: Папки в vault. */
export function renderVaultFoldersSection(params: { containerEl: HTMLElement; plugin: AssistantPlugin }): void {
  const { containerEl, plugin } = params;

  containerEl.createEl("h3", { text: "Папки в vault" });

  new Setting(containerEl)
    .setName("Проекты")
    .setDesc("По умолчанию: Ассистент/Проекты")
    .addText((t) =>
      t
        .setPlaceholder("Ассистент/Проекты")
        .setValue(plugin.settings.folders.projects)
        .onChange(async (v) => {
          await plugin.applySettingsCommand({ type: "folders.update", patch: { projects: v } });
        }),
    );

  new Setting(containerEl)
    .setName("Люди")
    .setDesc("По умолчанию: Ассистент/Люди")
    .addText((t) =>
      t
        .setPlaceholder("Ассистент/Люди")
        .setValue(plugin.settings.folders.people)
        .onChange(async (v) => {
          await plugin.applySettingsCommand({ type: "folders.update", patch: { people: v } });
        }),
    );

  new Setting(containerEl)
    .setName("Встречи (календарь)")
    .setDesc("По умолчанию: Ассистент/Встречи")
    .addText((t) =>
      t
        .setPlaceholder("Ассистент/Встречи")
        .setValue(plugin.settings.folders.calendarEvents)
        .onChange(async (v) => {
          await plugin.applySettingsCommand({ type: "folders.update", patch: { calendarEvents: v } });
        }),
    );

  new Setting(containerEl)
    .setName("Протоколы")
    .setDesc("По умолчанию: Ассистент/Протоколы")
    .addText((t) =>
      t
        .setPlaceholder("Ассистент/Протоколы")
        .setValue(plugin.settings.folders.protocols)
        .onChange(async (v) => {
          await plugin.applySettingsCommand({ type: "folders.update", patch: { protocols: v } });
        }),
    );
}
