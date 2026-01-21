import { Setting } from "obsidian";
import type AssistantPlugin from "../../../../main";
import { createSettingsNotice } from "../helpers";
import { makeDefaultCalendar, renderCalendarBlock } from "./calendarBlocks";

/** Отрисовать секцию настроек: Подключенные календари. */
export function renderConnectedCalendarsSection(params: {
  containerEl: HTMLElement;
  plugin: AssistantPlugin;
  rerenderPreservingScroll: () => void;
}): void {
  const { containerEl, plugin } = params;

  containerEl.createEl("h3", { text: "Подключенные календари" });

  const cals = plugin.settings.calendars;
  if (cals.length === 0) {
    createSettingsNotice({
      containerEl,
      variant: "warning",
      title: "⚠️ Нет подключенных календарей",
      desc: "Добавьте календарь (ICS URL или CalDAV), чтобы появились встречи в «Повестке» и уведомления.",
    });
  }

  for (const cal of cals) {
    const block = containerEl.createDiv({ cls: "assistant-settings__calendar-block" });
    renderCalendarBlock({ containerEl: block, plugin, cal, rerenderPreservingScroll: params.rerenderPreservingScroll });
  }

  new Setting(containerEl)
    .setName("Добавить календарь")
    .setDesc("Добавляет новый календарь. По умолчанию: ICS URL.")
    .addButton((b) =>
      b.setButtonText("Добавить").onClick(async () => {
        plugin.settings.calendars.push(makeDefaultCalendar());
        await plugin.saveSettingsAndApply();
        params.rerenderPreservingScroll();
      }),
    );
}
