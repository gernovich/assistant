import { Setting } from "obsidian";
import type AssistantPlugin from "../../../../main";

/** Отрисовать секцию настроек: Лог. */
export function renderLogSection(params: { containerEl: HTMLElement; plugin: AssistantPlugin }): void {
  const { containerEl, plugin } = params;

  containerEl.createEl("h3", { text: "Лог" });

  // Лог в файлы пишется вне хранилища (vault) (в .obsidian/plugins/assistant/logs), поэтому настройки папки/включения не нужны.

  new Setting(containerEl)
    .setName("Размер лога (строк)")
    .setDesc("Сколько последних записей хранить в панели лога. По умолчанию 2048.")
    .addText((t) =>
      t
        .setPlaceholder("2048")
        .setValue(String(plugin.settings.log.maxEntries))
        .onChange(async (v) => {
          const n = Number(v);
          await plugin.applySettingsCommand({ type: "log.update", patch: { maxEntries: Number.isFinite(n) ? n : 2048 } });
        }),
    );

  new Setting(containerEl)
    .setName("Хранить лог‑файлы (дней)")
    .setDesc("Сколько дней хранить файлы логов в `.obsidian/plugins/assistant/logs` (по умолчанию 7).")
    .addText((t) =>
      t
        .setPlaceholder("7")
        .setValue(String(plugin.settings.log.retentionDays))
        .onChange(async (v) => {
          const n = Number(v);
          await plugin.applySettingsCommand({ type: "log.update", patch: { retentionDays: Number.isFinite(n) ? Math.floor(n) : 7 } });
        }),
    );
}
