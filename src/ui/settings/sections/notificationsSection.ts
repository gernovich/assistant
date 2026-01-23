import { Setting } from "obsidian";
import type AssistantPlugin from "../../../../main";

/** Отрисовать секцию настроек: Уведомления. */
export function renderNotificationsSection(params: { containerEl: HTMLElement; plugin: AssistantPlugin }): void {
  const { containerEl, plugin } = params;

  containerEl.createEl("h3", { text: "Уведомления" });

  new Setting(containerEl)
    .setName("Включить уведомления")
    .setDesc("Показывать напоминания о встречах календаря.")
    .addToggle((t) =>
      t.setValue(plugin.settings.notifications.enabled).onChange(async (v) => {
        await plugin.applySettingsCommand({ type: "notifications.update", patch: { enabled: v } });
      }),
    );

  new Setting(containerEl)
    .setName("Уведомлять за (минут)")
    .setDesc("За сколько минут до начала встречи показывать напоминание.")
    .addText((t) =>
      t
        .setPlaceholder("5")
        .setValue(String(plugin.settings.notifications.minutesBefore))
        .onChange(async (v) => {
          const n = Number(v);
          await plugin.applySettingsCommand({
            type: "notifications.update",
            patch: { minutesBefore: Number.isFinite(n) ? n : 5 },
          });
        }),
    );

  new Setting(containerEl)
    .setName("Уведомление в момент начала")
    .setDesc("Показывать уведомление, когда встреча началась.")
    .addToggle((t) =>
      t.setValue(plugin.settings.notifications.atStart).onChange(async (v) => {
        await plugin.applySettingsCommand({ type: "notifications.update", patch: { atStart: v } });
      }),
    );
}
