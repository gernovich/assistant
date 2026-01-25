import type { AssistantSettings, Event } from "../types";
import type { RecordingStats } from "./recordingService";
import { escHtml } from "../domain/policies/escHtml";
import { buildRecordingDialogModelPolicy } from "../domain/policies/recordingDialogModel";
import { installWindowTransportRequestBridge } from "../presentation/electronWindow/bridge/windowTransportBridge";
import type { WindowAction } from "../presentation/electronWindow/bridge/windowBridgeContracts";
import type { WindowRequest } from "../presentation/electronWindow/bridge/windowBridgeContracts";
import type { WindowTransportMessage } from "../presentation/electronWindow/bridge/windowBridgeContracts";
import { buildRecordingWindowHtml } from "../presentation/electronWindow/recording/recordingWindowHtml";
import { handleRecordingWindowAction } from "../presentation/electronWindow/bridge/windowActionRouter";
import type { RecordingController } from "../presentation/controllers/recordingController";
import { createDialogTransport } from "../presentation/electronWindow/transport/transportFactory";
import type { WindowTransport } from "../presentation/electronWindow/transport/windowTransport";
import type { TransportRegistry } from "../presentation/electronWindow/transport/transportRegistry";

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
  /** Абсолютный путь к директории плагина (для preload скрипта). */
  pluginDirPath?: string | null;
  transportRegistry?: TransportRegistry;
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

    // Определяем путь к preload скрипту
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require("node:path") as typeof import("node:path");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("node:fs") as typeof import("node:fs");
    
    let preloadPath: string;
    if (this.params.pluginDirPath) {
      // Используем явно переданный путь (рекомендуется)
      preloadPath = path.resolve(this.params.pluginDirPath, "bridge-preload.cjs");
    } else {
      // Fallback на __dirname (может не работать в AppImage)
      preloadPath = path.join(__dirname, "bridge-preload.cjs");
    }
    
    // Проверяем существование файла
    if (!fs.existsSync(preloadPath)) {
      this.params.onLog?.(`Запись: WARNING - preload файл не найден: ${preloadPath}`);
      this.params.onLog?.(`Запись: pluginDirPath: ${this.params.pluginDirPath || "не передан"}, __dirname: ${__dirname}`);
    }

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
    // В Obsidian плагине код выполняется в renderer-процессе, поэтому используем ipcRenderer напрямую
    // Проблема: в renderer-процессе нет прямого способа получить свой webContentsId без remote API
    // Решение: используем несколько fallback методов для максимальной совместимости
    let hostWebContentsId = 0;
    try {
      const ipcRenderer = (electron as any)?.ipcRenderer;
      
      // Способ 1: remote.getCurrentWebContents() (устарел в Electron 20+, но работает в старых версиях)
      // Это основной способ для Electron < 20
      if ((electron as any)?.remote?.getCurrentWebContents) {
        const wc = (electron as any).remote.getCurrentWebContents();
        if (wc?.id) {
          hostWebContentsId = Number(wc.id);
        }
      }
      
      // Способ 2: ipcRenderer.senderId (может быть доступен в некоторых версиях Electron)
      // В некоторых версиях ipcRenderer имеет свойство senderId
      if (hostWebContentsId === 0 && ipcRenderer) {
        // Попробуем получить ID через внутренние свойства ipcRenderer
        // В некоторых версиях Electron ipcRenderer имеет _senderId или другие внутренние свойства
        if (typeof (ipcRenderer as any).senderId === "number") {
          hostWebContentsId = Number((ipcRenderer as any).senderId);
        } else if (typeof (ipcRenderer as any)._senderId === "number") {
          hostWebContentsId = Number((ipcRenderer as any)._senderId);
        }
      }
      
      // Способ 3: Используем webFrame для получения информации о текущем frame
      // webFrame может дать доступ к некоторым свойствам текущего контекста
      if (hostWebContentsId === 0) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const webFrame = require("electron").webFrame;
          // webFrame не дает прямой доступ к webContentsId, но мы можем попробовать другие методы
          // В некоторых версиях webFrame имеет доступ к webContents через внутренние свойства
          if (webFrame && typeof (webFrame as any).top === "object") {
            const topFrame = (webFrame as any).top;
            if (topFrame && typeof (topFrame as any).webContentsId === "number") {
              hostWebContentsId = Number((topFrame as any).webContentsId);
            }
          }
        } catch {
          // webFrame может быть недоступен
        }
      }
      
      // Если все способы не сработали, используем 0
      // В этом случае IPC сообщения не будут работать, но окно откроется
      // Это лучше, чем полный отказ от открытия окна
      if (hostWebContentsId === 0) {
        this.params.onLog?.("Запись: не удалось определить hostWebContentsId, IPC может не работать");
        this.params.onLog?.(`Запись: remote доступен: ${!!(electron as any)?.remote}`);
        this.params.onLog?.(`Запись: ipcRenderer доступен: ${!!ipcRenderer}`);
      } else {
        this.params.onLog?.(`Запись: hostWebContentsId определен: ${hostWebContentsId}`);
      }
    } catch (e) {
      this.params.onLog?.(`Запись: ошибка при определении hostWebContentsId: ${e}`);
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

    const transport: WindowTransport = this.params.transportRegistry
      ? this.params.transportRegistry.createDialogTransport({ webContents: win.webContents, hostWebContentsId })
      : createDialogTransport();
    transport.attach();

    const pushStats = (stats: RecordingStats) => {
      const payload: WindowTransportMessage = { type: "recording/stats", payload: stats as any };
      transport.send(payload);
    };

    const pushViz = (amp01: number) => {
      try {
        this.vizPushInFlight = true;
        const payload: WindowTransportMessage = { type: "recording/viz", payload: { amp01 } };
        transport.send(payload);
      } finally {
        this.vizPushInFlight = false;
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
        if (this.win) {
          this.win.close();
        }
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
    const unIpc = installWindowTransportRequestBridge({
      transport,
      timeoutMs: 2500,
      onRequest: async (req: WindowRequest) => {
        await onWindowAction(req.action);
      },
    });

    let dialogLoaded = false;
    let configSent = false;
    const trySendConfig = () => {
      if (configSent || !dialogLoaded) return;
      const config = transport.getConfig();
      if (!config) return;
      try {
        win.webContents.send("assistant/transport/config", config);
        configSent = true;
      } catch {
        // ignore
      }
    };
    transport.onReady(() => trySendConfig());
    win.webContents.once("did-finish-load", () => {
      dialogLoaded = true;
      trySendConfig();
    });

    // Cleanup слушателей: добавляем в win.on("close") (до закрытия) и win.on("closed") (после закрытия)
    // Это гарантирует cleanup даже если окно закрывается нестандартным способом
    let cleanupCalled = false;
    const doCleanup = () => {
      if (cleanupCalled) return;
      cleanupCalled = true;
      stopStatsTimer();
      try {
        unIpc();
        transport.close();
      } catch (e) {
        this.params.onLog?.(`Запись: ошибка при cleanup IPC: ${e}`);
      }
    };

    win.once("ready-to-show", () => {
      win.show();
    });

    win.on("close", () => {
      // Cleanup до закрытия окна
      doCleanup();
    });

    win.on("closed", () => {
      // Cleanup после закрытия окна (fallback)
      doCleanup();
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
