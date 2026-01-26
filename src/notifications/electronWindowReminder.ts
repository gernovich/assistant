import type { Event } from "../types";
import { installWindowTransportRequestBridge } from "../presentation/electronWindow/bridge/windowTransportBridge";
import { buildReminderWindowHtml } from "../presentation/electronWindow/reminder/reminderWindowHtml";
import type { WindowAction } from "../presentation/electronWindow/bridge/windowBridgeContracts";
import type { WindowRequest } from "../presentation/electronWindow/bridge/windowBridgeContracts";
import { handleReminderWindowAction } from "../presentation/electronWindow/bridge/windowActionRouter";
import { createDialogTransport } from "../presentation/electronWindow/transport/transportFactory";
import type { WindowTransport } from "../presentation/electronWindow/transport/windowTransport";
import type { TransportRegistry } from "../presentation/electronWindow/transport/transportRegistry";

type ElectronLike = {
  remote?: { BrowserWindow?: any };
  BrowserWindow?: any;
  screen?: { getPrimaryDisplay?: () => { workArea?: { width: number; height: number } } };
};

/** Дополняет число ведущими нулями до 2 символов. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Форматировать оставшееся время в виде:
 * - < 60 минут: "MM:SS"
 * - >= 60 минут и < 24 часа: "HH:MM:SS"
 * - >= 24 часа: "D дней HH:MM:SS"
 */
function formatCountdownRu(diffMs: number): string {
  const d = Math.max(0, Math.floor(diffMs));
  const totalSec = Math.floor(d / 1000);

  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);

  // < 60 минут -> MM:SS (минуты 0..59)
  if (totalMin < 60) {
    return `${pad2(totalMin)}:${pad2(sec)}`;
  }

  const min = totalMin % 60;
  const totalHours = Math.floor(totalMin / 60);

  // < 24 часа -> HH:MM:SS
  if (totalHours < 24) {
    return `${pad2(totalHours)}:${pad2(min)}:${pad2(sec)}`;
  }

  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);
  return `${days} дней ${pad2(hours)}:${pad2(min)}:${pad2(sec)}`;
}

/**
 * Открывает окно напоминания о встрече (Electron BrowserWindow).
 */
export function showElectronReminderWindow(params: {
  ev: Event;
  kind: "before" | "start";
  minutesBefore: number;
  actions?: {
    createProtocol?: (ev: Event) => unknown | Promise<unknown>;
    startRecording?: (ev: Event) => void | Promise<void>;
    meetingCancelled?: (ev: Event) => void | Promise<void>;
  };
  /** Абсолютный путь к директории плагина (для preload скрипта). */
  pluginDirPath?: string | null;
  transportRegistry?: TransportRegistry;
  onLog?: (m: string) => void;
}): boolean {
  const { ev, kind, minutesBefore, actions, pluginDirPath } = params;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let electron: ElectronLike | undefined;
  try {
    electron = require("electron") as ElectronLike;
  } catch {
    // В тестовой среде модуля `electron` нет. Разрешаем тестовый мок через globalThis.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    electron = (globalThis as any).__assistantElectronMock as ElectronLike | undefined;
  }
  const BrowserWindow = electron?.remote?.BrowserWindow ?? electron?.BrowserWindow;
  if (!BrowserWindow) {
    return false;
  }

  const timeoutMs = 25_000;

  // Не выносим это в настройки (просили фиксировать как часть UX).
  const opacity = 0.96;
  const width = 760;
  const height = 420;

  // Определяем путь к preload скрипту
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("node:path") as typeof import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("node:fs") as typeof import("node:fs");

  let preloadPath: string;
  if (pluginDirPath) {
    // Используем явно переданный путь (рекомендуется)
    preloadPath = path.resolve(pluginDirPath, "bridge-preload.cjs");
  } else {
    // Резерв на __dirname (может не работать в AppImage)
    preloadPath = path.join(__dirname, "bridge-preload.cjs");
  }

  // Проверяем существование файла
  if (!fs.existsSync(preloadPath)) {
    params.onLog?.(`Напоминание: preload файл не найден: ${preloadPath}`);
    params.onLog?.(`Напоминание: pluginDirPath: ${pluginDirPath || "не передан"}, __dirname: ${__dirname}`);
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
  params.onLog?.(`WindowTransport: окно напоминания открыто (${kind}, ${minutesBefore}m)`);

  try {
    win.setAlwaysOnTop(true, "screen-saver");
  } catch {
    // Игнорируем ошибку — окно всё равно должно открыться.
  }

  try {
    win.setOpacity(opacity);
  } catch {
    // Игнорируем ошибку — прозрачность не критична.
  }

  // Центрируем по workArea (если доступно)
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

  const startIso = ev.start.toISOString();
  const endIso = ev.end ? ev.end.toISOString() : "";
  const summary = String(ev.summary ?? "");
  const location = String(ev.location ?? "");
  const urlLink = String(ev.url ?? "");

  const startMs = ev.start.getTime();
  const nowMs = Date.now();
  const initialDiffMs = startMs - nowMs;
  const initialEventLine = summary.trim();

  const initialStatusLine = kind === "start" || initialDiffMs <= 0 ? `Уже началась` : `Через ${formatCountdownRu(initialDiffMs)}`;
  const initialTitleLine = initialEventLine;

  const detailsText = [`Начало: ${ev.start.toLocaleString("ru-RU")}`, ev.end ? `Конец: ${ev.end.toLocaleString("ru-RU")}` : ""]
    .filter(Boolean)
    .join("\n");

  // IPC не используем. WindowTransport работает без hostWebContentsId.
  const hostWebContentsId = 0;

  const onWindowAction = (a: WindowAction) => {
    try {
      // Важно: запускаем action, но не держим окно открытым, пока он выполняется.
      // UX: окно закрывается сразу по клику (как и раньше по факту), а оркестрация продолжает выполняться.
      void handleReminderWindowAction(a, {
        close: async () => undefined,
        startRecording: async () => actions?.startRecording?.(ev),
        createProtocol: async () => {
          await actions?.createProtocol?.(ev);
        },
        meetingCancelled: async () => {
          await actions?.meetingCancelled?.(ev);
        },
      });
    } finally {
      try {
        win.close();
      } catch {
        // Игнорируем ошибки — ниже резервный сценарий.
      }
    }
  };

    const transport: WindowTransport = params.transportRegistry
      ? params.transportRegistry.createDialogTransport({ webContents: win.webContents, hostWebContentsId })
      : createDialogTransport({ webContents: win.webContents });
  transport.attach();
  transport.onReady(() => {
    params.onLog?.(`WindowTransport: транспорт окна напоминания готов (${kind})`);
  });

  const html = buildReminderWindowHtml({
    kind,
    hostWebContentsId,
    cspConnectSrc: transport.getCspConnectSrc() ?? [],
    initialStatusLine,
    initialTitleLine,
    detailsText,
    startIso,
    endIso,
    summary,
    location,
    urlLink,
    minutesBefore,
  });

  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  void win.loadURL(url);
  const unIpc = installWindowTransportRequestBridge({
    transport,
    timeoutMs: 2000,
    onRequest: async (req: WindowRequest) => {
      onWindowAction(req.action);
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
    try {
      unIpc();
      transport.close();
      params.onLog?.(`WindowTransport: окно напоминания закрыто (${kind})`);
    } catch (e) {
      params.onLog?.(`Напоминание: ошибка при очистке WindowTransport: ${e}`);
    }
  };

  win.on("close", () => {
    // Очистка до закрытия окна.
    doCleanup();
  });

  win.on("closed", () => {
    // Очистка после закрытия окна (резерв).
    doCleanup();
  });

  win.once("ready-to-show", () => {
    try {
      win.showInactive();
    } catch {
      win.show();
    }
  });

  window.setTimeout(() => {
    try {
      if (!win.isDestroyed()) win.close();
    } catch {
      // Игнорируем ошибку закрытия окна.
    }
  }, timeoutMs);

  return true;
}
