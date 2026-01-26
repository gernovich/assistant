import type { AssistantSettings, Event } from "../types";
import type { RecordingStats, RecordingStatus } from "./recordingService";
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
import { RecordingVizNormalizer } from "./recordingVizNormalizer";

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
  /** Сигнал закрытия окна (для оркестрации). */
  onClosed?: () => void;
  recordingController: RecordingController;
  onLog?: (m: string) => void;
  /** Абсолютный путь к директории плагина (для preload скрипта). */
  pluginDirPath?: string | null;
  transportRegistry?: TransportRegistry;
};

/**
 * Диалог диктофона (Electron-окно) для управления записью.
 */
export class RecordingDialog {
  /** Текущее окно диктофона. */
  private win: any | null = null;
  /** Таймер периодической отправки статистики. */
  private statsTimer?: number;
  /** Таймер пакетной отправки визуализации. */
  private vizTimer?: number;
  /** Защита от одновременной отправки кадра визуализации. */
  private vizPushInFlight = false;

  constructor(private params: RecordingDialogParams) {}

  /** Открывает окно диктофона и связывает transport с контроллером записи. */
  open(): void {
    let electron: ElectronLike | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      electron = require("electron") as ElectronLike;
    } catch {
      electron = (globalThis as any).__assistantElectronMock as ElectronLike | undefined;
    }
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
      // Резерв на __dirname (может не работать в AppImage)
      preloadPath = path.join(__dirname, "bridge-preload.cjs");
    }

    // Проверяем существование файла
    if (!fs.existsSync(preloadPath)) {
      this.params.onLog?.(`Запись: ПРЕДУПРЕЖДЕНИЕ - preload файл не найден: ${preloadPath}`);
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
    this.params.onLog?.("WindowTransport: окно записи открыто");

    try {
      win.setAlwaysOnTop(true, "screen-saver");
    } catch {
      // Игнорируем ошибку — окно всё равно должно открыться.
    }
    try {
      win.setOpacity(0.96);
    } catch {
      // Игнорируем ошибку — прозрачность не критична.
    }

    try {
      const wa = electron?.screen?.getPrimaryDisplay?.()?.workArea;
      if (wa?.width && wa?.height) {
        const x = Math.max(0, Math.round((wa.width - width) / 2));
        const y = Math.max(0, Math.round((wa.height - height) / 3));
        win.setPosition(x, y);
      }
    } catch {
      // Игнорируем ошибки позиционирования.
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

    // Список встреч (без дат), сортируем по дате ближайшего occurrence (из будущих).
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
    const hostWebContentsId = 0;
    const transport: WindowTransport = this.params.transportRegistry
      ? this.params.transportRegistry.createDialogTransport({ webContents: win.webContents, hostWebContentsId })
      : createDialogTransport({ webContents: win.webContents });
    transport.attach();
    transport.onReady(() => {
      this.params.onLog?.("WindowTransport: транспорт окна записи готов");
    });

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
      debugEnabled: Boolean(this.params.settings.debug?.enabled),
      cspConnectSrc: transport.getCspConnectSrc() ?? [],
    });

    const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    void win.loadURL(url);

    const vizNormalizer = new RecordingVizNormalizer({
      outputIntervalMs: 33,
      logIntervalMs: 1000,
      onLog: (m) => this.params.onLog?.(m),
    });

    const stopStatsTimer = () => {
      if (this.statsTimer) window.clearInterval(this.statsTimer);
      this.statsTimer = undefined;
      if (this.vizTimer) window.clearInterval(this.vizTimer);
      this.vizTimer = undefined;
      vizNormalizer.reset();
      this.vizPushInFlight = false;
    };

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
    const pushVizClear = () => {
      try {
        const payload: WindowTransportMessage = { type: "recording/viz-clear", payload: {} };
        transport.send(payload);
      } catch {
        // Игнорируем ошибки очистки визуализации.
      }
    };
    const clearViz = () => {
      vizNormalizer.reset();
      pushViz(0);
      pushVizClear();
    };

    this.params.recordingController.setOnStats((s) => pushStats(s));
    this.params.recordingController.setOnViz((amp01) => {
      const st = this.params.recordingController.getStats();
      if (st.status !== "recording") return;
      vizNormalizer.push(Number(amp01), Date.now());
    });
    // Батч-пуш визуализации: 30fps, дропаем кадры если webContents занят.
    let lastVizStatus: RecordingStatus = "idle";
    let lastVizLogAtMs = 0;
    this.vizTimer = window.setInterval(() => {
      if (!this.win) return;
      if (this.vizPushInFlight) return;
      const st = this.params.recordingController.getStats();
      const status = st.status as RecordingStatus;
      const now = Date.now();
      if (status === "recording" && lastVizStatus === "idle") {
        clearViz();
      }
      if (status === "paused" && lastVizStatus === "recording") {
        vizNormalizer.pause(now);
      }
      if (status === "recording" && lastVizStatus === "paused") {
        vizNormalizer.resume(now);
      }
      // Если запись на паузе — не сбрасываем буфер, просто не отправляем viz.
      if (status === "paused") {
        lastVizStatus = status;
        return;
      }
      // Если запись завершена — сбрасываем буфер и очищаем визуализацию.
      if (status === "idle") {
        if (lastVizStatus !== "idle") {
          clearViz();
        }
        lastVizStatus = status;
        return;
      }
      lastVizStatus = status;

      const v = vizNormalizer.pull(now);
      if (v == null) return;
      if (now - lastVizLogAtMs > 1000) {
        lastVizLogAtMs = now;
        this.params.onLog?.(`Визуализация: отправка viz в окно amp01=${Number(v).toFixed(3)}`);
      }
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
        // Игнорируем ошибки закрытия.
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
            // Игнорируем ошибки остановки записи при закрытии.
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
          clearViz();
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

    // Транспорт: обмен сообщениями через WindowTransport.
    const unIpc = installWindowTransportRequestBridge({
      transport,
      timeoutMs: 2500,
      onRequest: async (req: WindowRequest) => {
        await onWindowAction(req.action);
      },
    });
    const unVizDebug = transport.onMessage((msg) => {
      try {
        const m = msg as { type?: string; payload?: any };
        if (!m) return;
        if (m.type === "recording/viz-debug") {
          const amp01 = Number(m.payload?.amp01 ?? 0);
          const w = Number(m.payload?.canvas?.w ?? 0);
          const h = Number(m.payload?.canvas?.h ?? 0);
          this.params.onLog?.(`Визуализация: окно получило amp01=${amp01.toFixed(3)} canvas=${w}x${h}`);
          return;
        }
        if (m.type === "recording/diag") {
          const kind = String(m.payload?.kind ?? "");
          const w = Number(m.payload?.canvas?.w ?? 0);
          const h = Number(m.payload?.canvas?.h ?? 0);
          const points = Number(m.payload?.points ?? 0);
          const ampTarget = Number(m.payload?.ampTarget ?? 0);
          this.params.onLog?.(
            `Визуализация: diag ${kind} canvas=${w}x${h} points=${points} ampTarget=${ampTarget.toFixed(3)}`,
          );
        }
      } catch {
        // Игнорируем ошибки диагностики.
      }
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
        // Игнорируем ошибки отправки конфигурации.
      }
    };
    transport.onReady(() => trySendConfig());
    win.webContents.once("did-finish-load", () => {
      dialogLoaded = true;
      trySendConfig();
    });

    // Очистка слушателей: добавляем в win.on("close") (до закрытия) и win.on("closed") (после закрытия).
    // Это гарантирует очистку даже если окно закрывается нестандартным способом.
    let cleanupCalled = false;
    const doCleanup = () => {
      if (cleanupCalled) return;
      cleanupCalled = true;
      stopStatsTimer();
      try {
        unIpc();
        unVizDebug();
        transport.close();
        this.params.onLog?.("WindowTransport: окно записи закрыто");
      } catch (e) {
        this.params.onLog?.(`Запись: ошибка при очистке WindowTransport: ${e}`);
      }
    };

    win.once("ready-to-show", () => {
      win.show();
    });

    win.on("close", () => {
      // Очистка до закрытия окна.
      doCleanup();
    });

    win.on("closed", () => {
      // Очистка после закрытия окна (резерв).
      doCleanup();
      try {
        this.params.onClosed?.();
      } catch {
        // Игнорируем ошибки коллбека закрытия.
      }
      try {
        const st = this.params.recordingController.getStats();
        if (st.status !== "idle") void this.params.recordingController.stopResult();
      } catch {
        // Игнорируем ошибки остановки записи после закрытия.
      }
      this.win = null;
    });
  }
}
