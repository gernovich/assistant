import type { AssistantSettings, Event } from "../types";
import type { RecordingStats } from "./recordingService";
import { escHtml } from "../domain/policies/escHtml";
import { buildRecordingDialogModelPolicy } from "../domain/policies/recordingDialogModel";
import { installElectronIpcRequestBridge } from "../presentation/electronWindow/bridge/windowBridge";
import type { WindowAction } from "../presentation/electronWindow/bridge/windowBridgeContracts";
import type { WindowRequest } from "../presentation/electronWindow/bridge/windowBridgeContracts";
import { pushRecordingStats, pushRecordingViz } from "../presentation/electronWindow/bridge/windowBridge";
import { buildRecordingWindowHtml } from "../presentation/electronWindow/recording/recordingWindowHtml";
import { handleRecordingWindowAction } from "../presentation/electronWindow/bridge/windowActionRouter";
import type { RecordingController } from "../presentation/controllers/recordingController";

type ElectronLike = {
  remote?: { BrowserWindow?: any };
  BrowserWindow?: any;
  screen?: { getPrimaryDisplay?: () => { workArea?: { width: number; height: number } } };
};

type RecordingDialogParams = {
  settings: AssistantSettings;
  events: Event[];
  /** Список протоколов для режима "продолжить" (path + label). */
  protocols?: Array<{ path: string; label: string }>;
  defaultEventKey?: string;
  lockDefaultEvent?: boolean;
  defaultCreateNewProtocol: boolean;
  /** @returns путь протокола (md), чтобы запись могла прикреплять файлы в `files:`. */
  onCreateProtocol?: (ev: Event) => string | null | undefined | Promise<string | null | undefined>;
  /** @returns путь протокола (md), чтобы запись могла прикреплять файлы в `files:`. */
  onCreateEmptyProtocol?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Открыть протокол в редакторе (клик по протоколу в диалоге). */
  onOpenProtocol?: (protocolFilePath: string) => void | Promise<void>;
  recordingController: RecordingController;
  onLog?: (m: string) => void;
};

export class RecordingDialog {
  private win: any | null = null;
  private statsTimer?: number;
  private vizTimer?: number;
  private latestAmp01: number | null = null;
  private vizPushInFlight = false;

  constructor(private params: RecordingDialogParams) {}

  open(): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require("electron") as ElectronLike;
    const BrowserWindow = electron?.remote?.BrowserWindow ?? electron?.BrowserWindow;
    if (!BrowserWindow) {
      this.params.onLog?.("Запись: Electron BrowserWindow недоступен (окно диктофона не может быть открыто)");
      return;
    }

    const width = 760;
    const height = 420;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require("node:path") as typeof import("node:path");
    const preloadPath = path.join(__dirname, "ipc-preload.cjs");

    const win = new BrowserWindow({
      width,
      height,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: true,
      backgroundColor: "#00000000",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload: preloadPath,
      },
    });
    this.win = win;

    try {
      win.setAlwaysOnTop(true, "screen-saver");
    } catch {
      // ignore
    }
    try {
      win.setOpacity(0.96);
    } catch {
      // ignore
    }

    try {
      const wa = electron?.screen?.getPrimaryDisplay?.()?.workArea;
      if (wa?.width && wa?.height) {
        const x = Math.max(0, Math.round((wa.width - width) / 2));
        const y = Math.max(0, Math.round((wa.height - height) / 3));
        win.setPosition(x, y);
      }
    } catch {
      // ignore
    }

    const nowMs = Date.now();
    const defaultKey = this.params.defaultEventKey ?? "";
    const model = buildRecordingDialogModelPolicy({
      events: this.params.events,
      nowMs,
      defaultEventKey: defaultKey,
      lockDefaultEvent: Boolean(this.params.lockDefaultEvent),
      autoStartSeconds: this.params.settings.recording.autoStartSeconds,
      keyOfEvent: (ev) => `${ev.calendar.id}:${ev.id}`,
      labelOfEvent: (ev) =>
        `${ev.start.toLocaleString("ru-RU", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} — ${ev.summary}`,
    });

    const options = [`<option value="">(не выбрано)</option>`]
      .concat(
        model.occurrences.map(
          (x) => `<option value="${escHtml(x.key)}"${x.key === defaultKey ? " selected" : ""}>${escHtml(x.label)}</option>`,
        ),
      )
      .join("");

    // Event: список встреч (без дат), сортируем по дате ближайшего occurrence (из будущих).
    const meetingOptions = [`<option value="">(не выбрано)</option>`]
      .concat(model.meetingNames.map((name) => `<option value="${escHtml(name)}">${escHtml(name)}</option>`))
      .join("");

    const lockedLabel = model.lockedLabel;
    const protocolOptions = [`<option value="">(не выбрано)</option>`]
      .concat(
        (this.params.protocols ?? [])
          .slice(0, 200)
          .map((p) => `<option value="${escHtml(String(p.path))}">${escHtml(String(p.label || p.path))}</option>`),
      )
      .join("");
    // Host webContentsId (Obsidian renderer), used by window preload to send IPC requests via sendTo(hostId,...)
    let hostWebContentsId = 0;
    try {
      hostWebContentsId = Number((electron as any)?.remote?.getCurrentWebContents?.()?.id ?? (electron as any)?.ipcRenderer?.senderId ?? 0);
    } catch {
      hostWebContentsId = 0;
    }

    const html = buildRecordingWindowHtml({
      defaultOccurrenceKey: String(defaultKey || ""),
      optionsHtml: options,
      meetingOptionsHtml: meetingOptions,
      protocolOptionsHtml: protocolOptions,
      lockDefaultEvent: Boolean(this.params.lockDefaultEvent),
      lockedLabel: String(lockedLabel || ""),
      autoEnabled: Boolean(this.params.settings.recording.autoStartEnabled),
      autoSeconds: model.autoSeconds,
      meta: model.meta,
      hostWebContentsId,
    });

    const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    void win.loadURL(url);

    const stopStatsTimer = () => {
      if (this.statsTimer) window.clearInterval(this.statsTimer);
      this.statsTimer = undefined;
      if (this.vizTimer) window.clearInterval(this.vizTimer);
      this.vizTimer = undefined;
      this.latestAmp01 = null;
      this.vizPushInFlight = false;
    };

    const pushStats = (stats: RecordingStats) => {
      if (!this.win) return;
      pushRecordingStats({ win: this.win as any, stats: stats as any });
    };

    const pushViz = (amp01: number) => {
      if (!this.win) return;
      try {
        this.vizPushInFlight = true;
        const p = pushRecordingViz({ win: this.win as any, viz: { amp01 } });
        void p?.finally?.(() => {
          this.vizPushInFlight = false;
        });
      } catch {
        this.vizPushInFlight = false;
        // ignore
      }
    };

    this.params.recordingController.setOnStats((s) => pushStats(s));
    let lastVizLogAt = 0;
    this.params.recordingController.setOnViz((amp01) => {
      // Важно: не вызываем executeJavaScript на каждый сэмпл — это легко забивает очередь и визуально даёт 1fps.
      // Вместо этого сохраняем последнее значение, а в окно пушим батчом таймером (см. vizTimer ниже).
      this.latestAmp01 = Number(amp01);
      // Диагностика доставки в окно: раз в ~2 секунды пишем, что окно реально получает onViz callback.
      const now = Date.now();
      if (now - lastVizLogAt > 2000) {
        lastVizLogAt = now;
        try {
          this.params.onLog?.(`Viz: amp01=${Number(amp01).toFixed(3)}`);
        } catch {
          // ignore
        }
      }
    });
    // Батч-пуш визуализации: 30fps, дропаем кадры если webContents занят.
    this.vizTimer = window.setInterval(() => {
      if (!this.win) return;
      if (this.vizPushInFlight) return;
      const v = this.latestAmp01;
      if (v == null || !Number.isFinite(v)) return;
      pushViz(v);
    }, 33);
    this.statsTimer = window.setInterval(() => pushStats(this.params.recordingController.getStats()), 1000);

    const close = () => {
      stopStatsTimer();
      try {
        this.win?.close();
      } catch {
        // ignore
      }
      this.win = null;
    };

    const onWindowAction = async (a: WindowAction) => {
      await handleRecordingWindowAction(a, {
        close: async () => {
          try {
            const st = this.params.recordingController.getStats();
            if (st.status !== "idle") {
              const res = await this.params.recordingController.stopResult();
              if (!res.ok) {
                this.params.onLog?.(`Запись: не удалось остановить: ${String(res.error.cause ?? res.error.message)}`);
              }
            }
          } catch {
            // ignore
          } finally {
            close();
          }
        },
        start: async (payload) => {
          const mode = String(payload?.mode ?? "manual_new").trim() || "manual_new";
          const occurrenceKey = String(payload?.occurrenceKey ?? "").trim();
          const eventSummary = String(payload?.eventSummary ?? "").trim();
          const existingProtocol = String(payload?.protocolFilePath ?? "").trim();
          let protocolFilePath: string | undefined = existingProtocol || undefined;
          let resolvedEventKey: string | undefined = occurrenceKey || undefined;

          // Любой путь должен привести к выбранному протоколу:
          // 1) manual_new -> создаём пустой протокол
          // 2) occurrence_new  -> создаём протокол для выбранного события (occurrence)
          // 3) event_new -> создаём протокол для встречи (Event/master): берём ближайшее событие по summary
          // 3) continue_existing -> используем выбранный протокол
          if (!protocolFilePath) {
            if (mode === "occurrence_new" && occurrenceKey) {
              const ev = this.params.events.find((e) => `${e.calendar.id}:${e.id}` === occurrenceKey);
              if (ev) {
                const p = await this.params.onCreateProtocol?.(ev);
                protocolFilePath = typeof p === "string" && p.trim() ? p.trim() : undefined;
              }
            } else if (mode === "event_new" && eventSummary) {
              const ev =
                this.params.events
                  .slice()
                  .sort((a, b) => a.start.getTime() - b.start.getTime())
                  .find((e) => String(e.summary || "").trim() === eventSummary) ?? null;
              if (ev) {
                resolvedEventKey = `${ev.calendar.id}:${ev.id}`;
                const p = await this.params.onCreateProtocol?.(ev);
                protocolFilePath = typeof p === "string" && p.trim() ? p.trim() : undefined;
              }
            } else if (mode === "manual_new") {
              const p = await this.params.onCreateEmptyProtocol?.();
              protocolFilePath = typeof p === "string" && p.trim() ? p.trim() : undefined;
            }
          }

          const res = await this.params.recordingController.startResult({
            eventKey: resolvedEventKey,
            protocolFilePath,
          });
          if (!res.ok) {
            this.params.onLog?.(`Запись: не удалось запустить: ${String(res.error.cause ?? res.error.message)}`);
          }
          // Обновляем UI (он сам корректно покажет status).
          pushStats(this.params.recordingController.getStats());
        },
        openProtocol: async (protocolFilePath) => {
          const p = String(protocolFilePath ?? "").trim();
          if (protocolFilePath) {
            await this.params.onOpenProtocol?.(p);
          }
        },
        stop: async () => {
          const res = await this.params.recordingController.stopResult();
          if (!res.ok) {
            this.params.onLog?.(`Запись: не удалось остановить: ${String(res.error.cause ?? res.error.message)}`);
          }
          pushStats(this.params.recordingController.getStats());
        },
        pause: async () => {
          const res = await this.params.recordingController.pauseResult();
          if (!res.ok) {
            this.params.onLog?.(`Запись: не удалось поставить на паузу: ${String(res.error.cause ?? res.error.message)}`);
          }
          pushStats(this.params.recordingController.getStats());
        },
        resume: async () => {
          const res = await this.params.recordingController.resumeResult();
          if (!res.ok) {
            this.params.onLog?.(`Запись: не удалось продолжить: ${String(res.error.cause ?? res.error.message)}`);
          }
          pushStats(this.params.recordingController.getStats());
        },
      });
    };

    // Transport: Electron IPC sendTo.
    const unIpc = installElectronIpcRequestBridge({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expectedSenderId: Number((win.webContents as any)?.id ?? 0),
      timeoutMs: 2500,
      onRequest: async (req: WindowRequest) => {
        await onWindowAction(req.action);
      },
    });

    win.once("ready-to-show", () => {
      win.show();
    });

    win.on("closed", () => {
      stopStatsTimer();
      try { unIpc(); } catch { /* ignore */ }
      try {
        const st = this.params.recordingController.getStats();
        if (st.status !== "idle") void this.params.recordingController.stopResult();
      } catch {
        // ignore
      }
      this.win = null;
    });
  }
}

