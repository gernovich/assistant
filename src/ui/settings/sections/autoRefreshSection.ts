import { Setting } from "obsidian";
import type AssistantPlugin from "../../../../main";

/** Отрисовать секцию настроек: Автообновление. */
export function renderAutoRefreshSection(params: { containerEl: HTMLElement; plugin: AssistantPlugin }): void {
  const { containerEl, plugin } = params;

  containerEl.createEl("h3", { text: "Автообновление" });

  new Setting(containerEl)
    .setName("Автообновление календарей")
    .setDesc("Автоматически перечитывать календари по интервалу.")
    .addToggle((t) =>
      t.setValue(plugin.settings.calendar.autoRefreshEnabled).onChange(async (v) => {
        plugin.settings.calendar.autoRefreshEnabled = v;
        await plugin.saveSettingsAndApply();
      }),
    );

  new Setting(containerEl)
    .setName("Интервал (минут)")
    .setDesc("Как часто обновлять календари автоматически.")
    .addText((t) =>
      t
        .setPlaceholder("10")
        .setValue(String(plugin.settings.calendar.autoRefreshMinutes))
        .onChange(async (v) => {
          const n = Number(v);
          plugin.settings.calendar.autoRefreshMinutes = Number.isFinite(n) ? n : 10;
          await plugin.saveSettingsAndApply();
        }),
    );

  new Setting(containerEl)
    .setName("Мой email (для статуса приглашений)")
    .setDesc("Используется, чтобы в «Повестке» показывать статус: Принято/Отклонено/Возможно/Нет ответа (PARTSTAT из ICS/CalDAV).")
    .addText((t) =>
      t
        .setPlaceholder("me@example.com")
        .setValue(plugin.settings.calendar.myEmail)
        .onChange(async (v) => {
          plugin.settings.calendar.myEmail = v.trim();
          await plugin.saveSettingsAndApply();
        }),
    );

  new Setting(containerEl)
    .setName("Кэш календаря: лимит событий/календарь")
    .setDesc("Сколько событий максимум сохранять на диск в persistent cache (по одному календарю).")
    .addText((t) =>
      t
        .setPlaceholder("2000")
        .setValue(String(plugin.settings.calendar.persistentCacheMaxEventsPerCalendar))
        .onChange(async (v) => {
          const n = Number(v);
          plugin.settings.calendar.persistentCacheMaxEventsPerCalendar = Number.isFinite(n) ? Math.floor(n) : 2000;
          await plugin.saveSettingsAndApply();
        }),
    );
}
