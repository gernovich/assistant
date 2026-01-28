import { Setting } from "obsidian";
import type AssistantPlugin from "../../../../main";

/** Отрисовать секцию настроек: Транскрибация. */
export function renderTranscriptionSection(params: { containerEl: HTMLElement; plugin: AssistantPlugin }): void {
  const { containerEl, plugin } = params;

  // Важно: `containerEl` общий для всей вкладки настроек, поэтому ререндерим
  // только свой кусок внутри отдельного div.
  let sectionEl = containerEl.querySelector("#assistant-transcription-section") as HTMLDivElement | null;
  if (!sectionEl) {
    sectionEl = containerEl.createDiv();
    sectionEl.id = "assistant-transcription-section";
  }
  sectionEl.empty();

  sectionEl.createEl("h3", { text: "Транскрибация" });
  const provider = String(plugin.settings.transcription?.provider ?? "nexara");

  new Setting(sectionEl)
    .setName("Включить фоновую расшифровку")
    .setDesc(
      "Раз в N минут ищем протоколы с прикреплёнными файлами записи и добавляем расшифровку в раздел «Расшифровка».\n\nБез диаризации и без нормализации. С таймингами по сегментам.",
    )
    .addToggle((t) => {
      t.setValue(Boolean(plugin.settings.transcription?.enabled));
      t.onChange(async (v) => {
        await plugin.applySettingsCommand({ type: "transcription.update", patch: { enabled: Boolean(v) } as any });
      });
    });

  new Setting(sectionEl)
    .setName("Сервис")
    .setDesc("Выберите сервис транскрибации.")
    .addDropdown((d) => {
      d.addOption("nexara", "Nexara");
      d.setValue(provider);
      d.onChange(async (v) => {
        await plugin.applySettingsCommand({ type: "transcription.update", patch: { provider: (v === "nexara" ? "nexara" : "nexara") as any } as any });
        // UI-поля могут зависеть от сервиса
        renderTranscriptionSection({ containerEl, plugin });
      });
    });

  if (provider === "nexara") {
    new Setting(sectionEl)
      .setName("Token (Nexara)")
      .setDesc(
        "Bearer token. Хранится локально в `.obsidian/plugins/assistant/data.json`.\nДокументация: https://docs.nexara.ru/ru/quickstart",
      )
      .addText((t) => {
        t.inputEl.type = "password";
        t.setValue(String(plugin.settings.transcription?.providers?.nexara?.token ?? ""));
        t.onChange(async (v) => {
          await plugin.applySettingsCommand({ type: "transcription.update", patch: { nexaraToken: String(v || "") } as any });
        });
      });
  }

  new Setting(sectionEl)
    .setName("Период, минут")
    .setDesc("Раз в N минут запускаем поиск нерасшифрованных файлов (по умолчанию 20).")
    .addText((t) => {
      t.setValue(String(plugin.settings.transcription?.pollMinutes ?? 20));
      t.onChange(async (v) => {
        const n = Number(v);
        await plugin.applySettingsCommand({
          type: "transcription.update",
          patch: { pollMinutes: Number.isFinite(n) ? n : (plugin.settings.transcription?.pollMinutes ?? 20) } as any,
        });
      });
    });
}

