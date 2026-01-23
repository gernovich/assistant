import { Setting } from "obsidian";
import type AssistantPlugin from "../../../../main";

/** Отрисовать секцию настроек: Запись. */
export function renderRecordingSection(params: { containerEl: HTMLElement; plugin: AssistantPlugin }): void {
  const { containerEl, plugin } = params;

  containerEl.createEl("h3", { text: "Запись" });

  new Setting(containerEl)
    .setName("Механизм записи звука")
    .setDesc(
      "Выбирает, как именно пишем звук.\n\n- Electron Media Devices: запись микрофона через `navigator.mediaDevices.getUserMedia` + MediaRecorder (Chromium/Electron).\n- Linux Native: запись микрофона + системного звука (monitor) через `ffmpeg` (PulseAudio/PipeWire). Требуется `ffmpeg` и рабочий monitor-источник.",
    )
    .addDropdown((d) => {
      d.addOption("electron_media_devices", "Electron Media Devices");
      d.addOption("linux_native", "Linux Native");
      // backward compat: старое значение показываем как новое
      d.setValue(
        plugin.settings.recording.audioBackend === ("electron_desktop_capturer" as any)
          ? "electron_media_devices"
          : plugin.settings.recording.audioBackend,
      );
      d.onChange(async (v) => {
        await plugin.applySettingsCommand({
          type: "recording.update",
          patch: { audioBackend: (v === "linux_native" ? "linux_native" : "electron_media_devices") as any },
        });
        renderLinuxDepsBox();
        renderLinuxProcessingBox();
      });
    });

  // Блок проверки зависимостей показываем сразу после выбора механизма записи.
  const linuxDepsBox = containerEl.createDiv();
  const linuxProcessingBox = containerEl.createDiv();

  function renderLinuxDepsBox() {
    linuxDepsBox.empty();
    const isLinuxNative = plugin.settings.recording.audioBackend === "linux_native";
    linuxDepsBox.style.display = isLinuxNative ? "block" : "none";
    if (!isLinuxNative) return;

    new Setting(linuxDepsBox)
      .setName("Linux Native: проверить зависимости")
      .setDesc("Проверяет наличие утилит в системе (например `ffmpeg`, `pw-record`, `parec`).")
      .addButton((b) =>
        b.setButtonText("Проверить").onClick(async () => {
          await plugin.settingsOps.checkLinuxNativeRecordingDependencies();
        }),
      );
  }
  renderLinuxDepsBox();

  function renderLinuxProcessingBox() {
    linuxProcessingBox.empty();
    const isLinuxNative = plugin.settings.recording.audioBackend === "linux_native";
    linuxProcessingBox.style.display = isLinuxNative ? "block" : "none";
    if (!isLinuxNative) return;

    new Setting(linuxProcessingBox)
      .setName("Linux Native: обработка звука")
      .setDesc(
        "Дополнительная обработка через `ffmpeg`.\n\n- Нет: только запись mic+monitor.\n- Нормализация: выравнивание громкости + лимитер.\n- Голос: лёгкий пресет для речи (EQ+мягкий шумодав на микрофоне) + нормализация.\n\nВажно: это влияет на качество и CPU, а также может менять характер звука.",
      )
      .addDropdown((d) => {
        d.addOption("none", "Нет");
        d.addOption("normalize", "Нормализация");
        d.addOption("voice", "Голос");
        d.setValue(plugin.settings.recording.linuxNativeAudioProcessing ?? "normalize");
        d.onChange(async (v) => {
          await plugin.applySettingsCommand({
            type: "recording.update",
            patch: { linuxNativeAudioProcessing: (v === "voice" ? "voice" : v === "none" ? "none" : "normalize") as any },
          });
        });
      });
  }
  renderLinuxProcessingBox();

  new Setting(containerEl)
    .setName("Длина чанка (минут)")
    .setDesc("Запись сохраняется отдельными файлами по N минут, чтобы можно было обрабатывать/распознавать параллельно.")
    .addText((t) =>
      t
        .setPlaceholder("5")
        .setValue(String(plugin.settings.recording.chunkMinutes))
        .onChange(async (v) => {
          const n = Number(String(v ?? "").trim());
          await plugin.applySettingsCommand({
            type: "recording.update",
            patch: { chunkMinutes: Number.isFinite(n) && n > 0 ? Math.floor(n) : 5 },
          });
        }),
    );

  new Setting(containerEl)
    .setName("Авто запись (если встреча уже идёт)")
    .setDesc("Если встреча уже началась, диалог записи покажет обратный отсчёт и сам нажмёт REC.")
    .addToggle((t) =>
      t.setValue(plugin.settings.recording.autoStartEnabled).onChange(async (v) => {
        await plugin.applySettingsCommand({ type: "recording.update", patch: { autoStartEnabled: v } });
      }),
    );

  new Setting(containerEl)
    .setName("Тайминг авто записи (сек)")
    .setDesc("По умолчанию 5 секунд.")
    .addText((t) =>
      t
        .setPlaceholder("5")
        .setValue(String(plugin.settings.recording.autoStartSeconds))
        .onChange(async (v) => {
          const n = Number(String(v ?? "").trim());
          await plugin.applySettingsCommand({
            type: "recording.update",
            patch: { autoStartSeconds: Number.isFinite(n) && n > 0 ? Math.floor(n) : 5 },
          });
        }),
    );
}
