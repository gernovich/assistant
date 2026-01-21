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
          plugin.settings.folders.projects = v.trim() || "Ассистент/Проекты";
          await plugin.saveSettingsAndApply();
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
          plugin.settings.folders.people = v.trim() || "Ассистент/Люди";
          await plugin.saveSettingsAndApply();
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
          plugin.settings.folders.calendarEvents = v.trim() || "Ассистент/Встречи";
          await plugin.saveSettingsAndApply();
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
          plugin.settings.folders.protocols = v.trim() || "Ассистент/Протоколы";
          await plugin.saveSettingsAndApply();
        }),
    );
}
