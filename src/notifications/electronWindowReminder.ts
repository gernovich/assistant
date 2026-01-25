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

  // < 60 минут -> MM:SS (minutes are 0..59)
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
    // Fallback на __dirname (может не работать в AppImage)
    preloadPath = path.join(__dirname, "bridge-preload.cjs");
  }
  
  // Проверяем существование файла
  if (!fs.existsSync(preloadPath)) {
    console.warn(`[Assistant] Reminder: WARNING - preload файл не найден: ${preloadPath}`);
    console.warn(`[Assistant] Reminder: pluginDirPath: ${pluginDirPath || "не передан"}, __dirname: ${__dirname}`);
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

  try {
    win.setAlwaysOnTop(true, "screen-saver");
  } catch {
    // ignore
  }

  try {
    win.setOpacity(opacity);
  } catch {
    // ignore
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
    // ignore
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
      console.warn("[Assistant] Reminder: не удалось определить hostWebContentsId, IPC может не работать");
      console.warn("[Assistant] Reminder: remote доступен:", !!(electron as any)?.remote);
      console.warn("[Assistant] Reminder: ipcRenderer доступен:", !!ipcRenderer);
    } else {
      console.log(`[Assistant] Reminder: hostWebContentsId определен: ${hostWebContentsId}`);
    }
  } catch (e) {
    console.warn(`[Assistant] Reminder: ошибка при определении hostWebContentsId: ${e}`);
    hostWebContentsId = 0;
  }

  const html = buildReminderWindowHtml({
    kind,
    hostWebContentsId,
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
        // ignore
      }
    }
  };

  const transport: WindowTransport = params.transportRegistry
    ? params.transportRegistry.createDialogTransport({ webContents: win.webContents, hostWebContentsId })
    : createDialogTransport();
  transport.attach();
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
    try {
      unIpc();
      transport.close();
    } catch (e) {
      console.warn(`[Assistant] Reminder: ошибка при cleanup IPC: ${e}`);
    }
  };

  win.on("close", () => {
    // Cleanup до закрытия окна
    doCleanup();
  });

  win.on("closed", () => {
    // Cleanup после закрытия окна (fallback)
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
      // ignore
    }
  }, timeoutMs);

  return true;
}
