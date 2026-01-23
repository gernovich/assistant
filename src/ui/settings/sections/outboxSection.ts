import { Setting } from "obsidian";
import type AssistantPlugin from "../../../../main";
import { createSettingsNotice } from "../helpers";

/** Отрисовать секцию настроек: Офлайн-очередь. */
export function renderOutboxSection(params: {
  containerEl: HTMLElement;
  plugin: AssistantPlugin;
  rerenderPreservingScroll: () => void;
}): void {
  const { containerEl, plugin } = params;

  containerEl.createEl("h3", { text: "Офлайн-очередь" });

  createSettingsNotice({
    containerEl,
    variant: "info",
    title: "ℹ️ Очередь изменений (offline-first)",
    desc: "Если действие нельзя применить сразу (например vault read-only), оно попадёт в очередь. Позже можно применить очередь.",
  });

  const countEl = containerEl.createDiv({ cls: "assistant-settings__notice-desc" });
  countEl.setText("Загрузка очереди…");
  void plugin.settingsOps
    .getOutboxCount()
    .then((n: number) => countEl.setText(`В очереди: ${n}`))
    .catch(() => countEl.setText("В очереди: ?"));

  new Setting(containerEl)
    .setName("Применить очередь")
    .setDesc("Попробовать применить отложенные действия. Ошибки будут в логе.")
    .addButton((b) =>
      b.setButtonText("Применить").onClick(async () => {
        await plugin.settingsOps.applyOutbox();
        params.rerenderPreservingScroll();
      }),
    );

  new Setting(containerEl)
    .setName("Очистить очередь")
    .setDesc("Удалить все отложенные действия без применения.")
    .addButton((b) =>
      b.setButtonText("Очистить").onClick(async () => {
        await plugin.settingsOps.clearOutbox();
        params.rerenderPreservingScroll();
      }),
    );
}
