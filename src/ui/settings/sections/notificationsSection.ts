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
        plugin.settings.notifications.enabled = v;
        await plugin.saveSettingsAndApply();
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
          plugin.settings.notifications.minutesBefore = Number.isFinite(n) ? n : 5;
          await plugin.saveSettingsAndApply();
        }),
    );

  new Setting(containerEl)
    .setName("Уведомление в момент начала")
    .setDesc("Показывать уведомление, когда встреча началась.")
    .addToggle((t) =>
      t.setValue(plugin.settings.notifications.atStart).onChange(async (v) => {
        plugin.settings.notifications.atStart = v;
        await plugin.saveSettingsAndApply();
      }),
    );
}
