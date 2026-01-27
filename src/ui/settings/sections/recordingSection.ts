import { Setting } from "obsidian";
import type AssistantPlugin from "../../../../main";

/** Отрисовать секцию настроек: Запись. */
export function renderRecordingSection(params: { containerEl: HTMLElement; plugin: AssistantPlugin }): void {
  const { containerEl, plugin } = params;

  let micProbeTimer: number | undefined;
  let monProbeTimer: number | undefined;
  let emdProbeTimer: number | undefined;
  let emdStream: MediaStream | null = null;
  let emdAudioCtx: AudioContext | null = null;
  let emdAnalyser: AnalyserNode | null = null;

  containerEl.createEl("h3", { text: "Запись" });

  new Setting(containerEl)
    .setName("Механизм записи звука")
    .setDesc(
      "Выбирает, как именно пишем звук.\n\n- Electron Media Devices: запись микрофона через `navigator.mediaDevices.getUserMedia` + MediaRecorder (Chromium/Electron).\n- GStreamer: запись через системные GStreamer-пайплайны (Linux). Требуются зависимости GStreamer.",
    )
    .addDropdown((d) => {
      d.addOption("electron_media_devices", "Electron Media Devices");
      d.addOption("g_streamer", "GStreamer");
      // Обратная совместимость: старое значение показываем как новое
      d.setValue(
        plugin.settings.recording.audioBackend === ("electron_desktop_capturer" as any)
          ? "electron_media_devices"
          : plugin.settings.recording.audioBackend,
      );
      d.onChange(async (v) => {
        stopAllProbes();
        await plugin.applySettingsCommand({
          type: "recording.update",
          patch: { audioBackend: (v === "g_streamer" ? "g_streamer" : "electron_media_devices") as any },
        });
        renderGStreamerDepsBox();
        renderGStreamerDevicesBox();
        renderElectronMediaDevicesBox();
      });
    });

  // Блок проверки зависимостей показываем сразу после выбора механизма записи.
  const gstreamerDepsBox = containerEl.createDiv();
  const gstreamerDevicesBox = containerEl.createDiv();
  const electronMediaDevicesBox = containerEl.createDiv();

  const stopAllProbes = () => {
    if (micProbeTimer) window.clearInterval(micProbeTimer);
    if (monProbeTimer) window.clearInterval(monProbeTimer);
    micProbeTimer = undefined;
    monProbeTimer = undefined;
    void plugin.settingsOps.stopGStreamerLevelProbe?.({ kind: "mic", device: plugin.settings.recording.gstreamerMicSource });
    void plugin.settingsOps.stopGStreamerLevelProbe?.({ kind: "monitor", device: plugin.settings.recording.gstreamerMonitorSource });

    if (emdProbeTimer) window.clearInterval(emdProbeTimer);
    emdProbeTimer = undefined;
    try {
      emdStream?.getTracks?.().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    emdStream = null;
    try {
      void emdAudioCtx?.close?.();
    } catch {
      // ignore
    }
    emdAudioCtx = null;
    emdAnalyser = null;
  };

  watchRemoval(containerEl, stopAllProbes);

  function renderGStreamerDepsBox() {
    gstreamerDepsBox.empty();
    const isGstreamer = plugin.settings.recording.audioBackend === "g_streamer";
    gstreamerDepsBox.style.display = isGstreamer ? "block" : "none";
    if (!isGstreamer) return;

    new Setting(gstreamerDepsBox)
      .setName("GStreamer: проверить зависимости")
      .setDesc("Проверяет наличие утилит GStreamer в системе (например `gst-launch-1.0`, `gst-inspect-1.0`).")
      .addButton((b) =>
        b.setButtonText("Проверить").onClick(async () => {
          await plugin.settingsOps.checkGStreamerRecordingDependencies();
        }),
      );
  }
  renderGStreamerDepsBox();
  renderElectronMediaDevicesBox();

  function renderGStreamerDevicesBox() {
    gstreamerDevicesBox.empty();
    const isGstreamer = plugin.settings.recording.audioBackend === "g_streamer";
    gstreamerDevicesBox.style.display = isGstreamer ? "block" : "none";
    if (!isGstreamer) return;

    let micDropdown: any;
    let monDropdown: any;

    const micSourceSetting = new Setting(gstreamerDevicesBox)
      .setName("GStreamer: микрофон (источник)")
      .setDesc("Авто = системный default source.")
      .addDropdown((d) => {
        micDropdown = d;
        d.addOption("auto", "Авто");
        d.setValue(plugin.settings.recording.gstreamerMicSource ?? "auto");
        d.onChange(async (v) => {
          const next = String(v || "auto");
          await plugin.applySettingsCommand({
            type: "recording.update",
            patch: { gstreamerMicSource: next },
          });
          if (next === "auto") void refreshMicActualFromAuto();
          else updateMicActual(next);
        });
      });
    const updateMicActual = (actual: string) => {
      const text = actual ? actual : "—";
      updateActualSpan("assistant-gst-mic-actual", text);
    };
    const refreshMicActualFromAuto = async () => {
      const actual = await plugin.settingsOps.resolveGStreamerActualSource?.({ kind: "mic" });
      updateMicActual(String(actual ?? "").trim());
    };
    ensureActualBlock(micSourceSetting.descEl, "assistant-gst-mic-actual");
    if (plugin.settings.recording.gstreamerMicSource === "auto") {
      void refreshMicActualFromAuto();
    } else {
      updateMicActual(plugin.settings.recording.gstreamerMicSource);
    }

    new Setting(gstreamerDevicesBox)
      .setName("GStreamer: обработка микрофона")
      .setDesc("Фильтр: none | normalize | voice.")
      .addDropdown((d) => {
        d.addOption("none", "Нет");
        d.addOption("normalize", "Нормализация");
        d.addOption("voice", "Голос");
        d.setValue(plugin.settings.recording.gstreamerMicProcessing ?? "none");
        d.onChange(async (v) => {
          await plugin.applySettingsCommand({
            type: "recording.update",
            patch: { gstreamerMicProcessing: (v === "voice" ? "voice" : v === "normalize" ? "normalize" : "none") as any },
          });
        });
      });

    const micLevelSetting = new Setting(gstreamerDevicesBox).setName("GStreamer: уровень микрофона");
    micLevelSetting.setDesc("");
    let micMeterEl: HTMLDivElement | null = createLevelMeter(micLevelSetting.descEl);
    let micProbeBtn: any;
    const stopMicProbe = () => {
      if (micProbeTimer) window.clearInterval(micProbeTimer);
      micProbeTimer = undefined;
      if (micMeterEl) updateLevelMeter(micMeterEl, 0);
      micProbeBtn?.setButtonText("Проверить");
    };
    const startMicProbe = () => {
      if (micProbeTimer) return;
      void plugin.settingsOps
        .startGStreamerLevelProbe?.({ kind: "mic", device: plugin.settings.recording.gstreamerMicSource })
        .then((r) => {
          const actual = String(r?.actualDevice ?? "").trim();
          if (actual) updateMicActual(actual);
        })
        .catch(() => undefined);
      micProbeBtn?.setButtonText("Завершить");
      micProbeTimer = window.setInterval(async () => {
        const r = await plugin.settingsOps.probeGStreamerLevel({
          kind: "mic",
          device: plugin.settings.recording.gstreamerMicSource,
        });
        const level01 = rmsDbToLevel01(r?.rmsDb);
        updateLevelMeter(micMeterEl!, level01);
      }, 400);
    };
    micLevelSetting.addButton((b) => {
      micProbeBtn = b;
      b.setButtonText("Проверить");
      b.onClick(() => {
      if (micProbeTimer) {
        void plugin.settingsOps.stopGStreamerLevelProbe?.({ kind: "mic", device: plugin.settings.recording.gstreamerMicSource });
        stopMicProbe();
      } else startMicProbe();
      });
    });

    const monSourceSetting = new Setting(gstreamerDevicesBox)
      .setName("GStreamer: монитор (источник)")
      .setDesc("Авто = системный default sink.monitor.")
      .addDropdown((d) => {
        monDropdown = d;
        d.addOption("auto", "Авто");
        d.setValue(plugin.settings.recording.gstreamerMonitorSource ?? "auto");
        d.onChange(async (v) => {
          const next = String(v || "auto");
          await plugin.applySettingsCommand({
            type: "recording.update",
            patch: { gstreamerMonitorSource: next },
          });
          if (next === "auto") void refreshMonActualFromAuto();
          else updateMonActual(next);
        });
      });
    const updateMonActual = (actual: string) => {
      const text = actual ? actual : "—";
      updateActualSpan("assistant-gst-mon-actual", text);
    };
    const refreshMonActualFromAuto = async () => {
      const actual = await plugin.settingsOps.resolveGStreamerActualSource?.({ kind: "monitor" });
      updateMonActual(String(actual ?? "").trim());
    };
    ensureActualBlock(monSourceSetting.descEl, "assistant-gst-mon-actual");
    if (plugin.settings.recording.gstreamerMonitorSource === "auto") {
      void refreshMonActualFromAuto();
    } else {
      updateMonActual(plugin.settings.recording.gstreamerMonitorSource);
    }

    new Setting(gstreamerDevicesBox)
      .setName("GStreamer: обработка монитора")
      .setDesc("Фильтр: none | normalize | voice.")
      .addDropdown((d) => {
        d.addOption("none", "Нет");
        d.addOption("normalize", "Нормализация");
        d.addOption("voice", "Голос");
        d.setValue(plugin.settings.recording.gstreamerMonitorProcessing ?? "none");
        d.onChange(async (v) => {
          await plugin.applySettingsCommand({
            type: "recording.update",
            patch: { gstreamerMonitorProcessing: (v === "voice" ? "voice" : v === "normalize" ? "normalize" : "none") as any },
          });
        });
      });

    const monLevelSetting = new Setting(gstreamerDevicesBox).setName("GStreamer: уровень монитора");
    monLevelSetting.setDesc("");
    let monMeterEl: HTMLDivElement | null = createLevelMeter(monLevelSetting.descEl);
    let monProbeBtn: any;
    const stopMonProbe = () => {
      if (monProbeTimer) window.clearInterval(monProbeTimer);
      monProbeTimer = undefined;
      if (monMeterEl) updateLevelMeter(monMeterEl, 0);
      monProbeBtn?.setButtonText("Проверить");
    };
    const startMonProbe = () => {
      if (monProbeTimer) return;
      void plugin.settingsOps
        .startGStreamerLevelProbe?.({ kind: "monitor", device: plugin.settings.recording.gstreamerMonitorSource })
        .then((r) => {
          const actual = String(r?.actualDevice ?? "").trim();
          if (actual) updateMonActual(actual);
        })
        .catch(() => undefined);
      monProbeBtn?.setButtonText("Завершить");
      monProbeTimer = window.setInterval(async () => {
        const r = await plugin.settingsOps.probeGStreamerLevel({
          kind: "monitor",
          device: plugin.settings.recording.gstreamerMonitorSource,
        });
        const level01 = rmsDbToLevel01(r?.rmsDb);
        updateLevelMeter(monMeterEl!, level01);
      }, 400);
    };
    monLevelSetting.addButton((b) => {
      monProbeBtn = b;
      b.setButtonText("Проверить");
      b.onClick(() => {
      if (monProbeTimer) {
        void plugin.settingsOps.stopGStreamerLevelProbe?.({ kind: "monitor", device: plugin.settings.recording.gstreamerMonitorSource });
        stopMonProbe();
      } else startMonProbe();
      });
    });

    void plugin.settingsOps
      .listGStreamerRecordingSources()
      .then(({ micSources, monitorSources }) => {
        const micSelect = micDropdown?.selectEl;
        const monSelect = monDropdown?.selectEl;
        for (const s of micSources || []) {
          if (!micSelect?.querySelector(`option[value="${s}"]`)) micDropdown?.addOption(s, s);
        }
        for (const s of monitorSources || []) {
          if (!monSelect?.querySelector(`option[value="${s}"]`)) monDropdown?.addOption(s, s);
        }
      })
      .catch(() => {
        // игнорируем ошибки загрузки списка
      });
  }

  function renderElectronMediaDevicesBox() {
    electronMediaDevicesBox.empty();
    const isEmd = plugin.settings.recording.audioBackend === "electron_media_devices";
    electronMediaDevicesBox.style.display = isEmd ? "block" : "none";
    if (!isEmd) return;

    const levelSetting = new Setting(electronMediaDevicesBox).setName("Electron Media Devices: уровень микрофона");
    levelSetting.setDesc("");
    const meterEl = createLevelMeter(levelSetting.descEl);

    let btn: any;
    const stop = () => {
      if (emdProbeTimer) window.clearInterval(emdProbeTimer);
      emdProbeTimer = undefined;
      updateLevelMeter(meterEl, 0);
      try {
        emdStream?.getTracks?.().forEach((t) => t.stop());
      } catch {
        // ignore
      }
      emdStream = null;
      try {
        void emdAudioCtx?.close?.();
      } catch {
        // ignore
      }
      emdAudioCtx = null;
      emdAnalyser = null;
      btn?.setButtonText("Проверить");
    };

    const start = async () => {
      if (emdProbeTimer) return;
      btn?.setButtonText("Завершить");
      try {
        emdStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        emdAudioCtx = new AudioContext();
        const src = emdAudioCtx.createMediaStreamSource(emdStream);
        emdAnalyser = emdAudioCtx.createAnalyser();
        emdAnalyser.fftSize = 2048;
        src.connect(emdAnalyser);

        const buf = new Uint8Array(emdAnalyser.fftSize);
        emdProbeTimer = window.setInterval(() => {
          if (!emdAnalyser) return;
          emdAnalyser.getByteTimeDomainData(buf);
          let sumSq = 0;
          for (let i = 0; i < buf.length; i += 1) {
            const v = (buf[i] - 128) / 128;
            sumSq += v * v;
          }
          const rms = Math.sqrt(sumSq / buf.length);
          updateLevelMeter(meterEl, rms);
        }, 50);
      } catch {
        stop();
      }
    };

    levelSetting.addButton((b) => {
      btn = b;
      b.setButtonText("Проверить");
      b.onClick(() => {
        if (emdProbeTimer) stop();
        else void start();
      });
    });
  }
  renderGStreamerDevicesBox();

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

function createLevelMeter(parent?: HTMLElement | null): HTMLDivElement {
  if (parent && typeof (parent as any).createDiv === "function") {
    const wrap = (parent as any).createDiv();
    return initLevelMeter(wrap);
  }
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const wrap = document.createElement("div");
    return initLevelMeter(wrap as HTMLDivElement);
  }
  return initLevelMeter(({ style: {} as CSSStyleDeclaration, appendChild: () => undefined } as unknown) as HTMLDivElement);
}

function initLevelMeter(wrap: HTMLDivElement): HTMLDivElement {
  wrap.style.display = "flex";
  wrap.style.gap = "2px";
  wrap.style.height = "10px";
  wrap.style.marginTop = "4px";
  wrap.style.alignItems = "flex-end";

  for (let i = 0; i < 16; i += 1) {
    const bar =
      typeof (wrap as any).createSpan === "function"
        ? (wrap as any).createSpan()
        : (typeof document !== "undefined" && document.createElement
            ? document.createElement("span")
            : ({ style: {} as CSSStyleDeclaration } as HTMLElement));
    bar.style.display = "inline-block";
    bar.style.width = "6px";
    bar.style.height = `${4 + i * 0.3}px`;
    bar.style.borderRadius = "2px";
    bar.style.background = "#444";
    if (typeof (wrap as any).appendChild === "function" && bar instanceof HTMLElement) {
      (wrap as any).appendChild(bar);
    }
  }
  return wrap;
}

function updateLevelMeter(wrap: HTMLDivElement, level01: number): void {
  const bars = Array.from(wrap.children) as HTMLElement[];
  const active = Math.round(Math.max(0, Math.min(1, level01)) * bars.length);
  for (let i = 0; i < bars.length; i += 1) {
    const isActive = i < active;
    const isPeak = i >= Math.floor(bars.length * 0.8);
    bars[i].style.background = isActive ? (isPeak ? "#e53935" : "#43a047") : "#444";
  }
}

function rmsDbToLevel01(rmsDb?: number): number {
  const n = typeof rmsDb === "number" && Number.isFinite(rmsDb) ? rmsDb : -120;
  const clamped = Math.max(-60, Math.min(0, n));
  return (clamped + 60) / 60;
}

function ensureActualBlock(descEl?: HTMLElement | null, spanId?: string): void {
  if (!descEl || !spanId) return;
  if (typeof document === "undefined") return;
  if (document.getElementById(spanId)) return;

  const div = document.createElement("div");
  const label = document.createElement("span");
  label.textContent = "Фактический: ";
  const span = document.createElement("span");
  span.id = spanId;
  span.textContent = "—";
  div.appendChild(label);
  div.appendChild(span);
  descEl.appendChild(div);
}

function updateActualSpan(spanId: string, text: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(spanId);
  if (el) el.textContent = text || "—";
}

function watchRemoval(el: HTMLElement, onRemoved: () => void): void {
  try {
    const parent = el.parentElement;
    if (!parent || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      if (!parent.contains(el)) {
        observer.disconnect();
        onRemoved();
      }
    });
    observer.observe(parent, { childList: true });
  } catch {
    // игнорируем ошибки наблюдателя
  }
}
