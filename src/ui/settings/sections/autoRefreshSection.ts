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
        await plugin.applySettingsCommand({ type: "calendarMeta.update", patch: { autoRefreshEnabled: v } });
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
          await plugin.applySettingsCommand({
            type: "calendarMeta.update",
            patch: { autoRefreshMinutes: Number.isFinite(n) ? n : 10 },
          });
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
          await plugin.applySettingsCommand({ type: "calendarMeta.update", patch: { myEmail: v.trim() } });
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
          await plugin.applySettingsCommand({
            type: "calendarMeta.update",
            patch: { persistentCacheMaxEventsPerCalendar: Number.isFinite(n) ? Math.floor(n) : 2000 },
          });
        }),
    );
}
