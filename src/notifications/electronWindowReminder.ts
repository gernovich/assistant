import type { Event } from "../types";
import { installElectronIpcRequestBridge } from "../presentation/electronWindow/bridge/windowBridge";
import { buildReminderWindowHtml } from "../presentation/electronWindow/reminder/reminderWindowHtml";
import type { WindowAction } from "../presentation/electronWindow/bridge/windowBridgeContracts";
import type { WindowRequest } from "../presentation/electronWindow/bridge/windowBridgeContracts";
import { handleReminderWindowAction } from "../presentation/electronWindow/bridge/windowActionRouter";

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
}): boolean {
  const { ev, kind, minutesBefore, actions } = params;

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
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      preload: require("node:path").join(__dirname, "ipc-preload.cjs"),
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
  let hostWebContentsId = 0;
  try {
    hostWebContentsId = Number((electron as any)?.remote?.getCurrentWebContents?.()?.id ?? (electron as any)?.ipcRenderer?.senderId ?? 0);
  } catch {
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

  // Transport: Electron IPC sendTo.
  const unIpc = installElectronIpcRequestBridge({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expectedSenderId: Number((win.webContents as any)?.id ?? 0),
    timeoutMs: 2000,
    onRequest: async (req: WindowRequest) => {
      onWindowAction(req.action);
    },
  });

  win.on("closed", () => {
    try {
      unIpc();
    } catch {
      // ignore
    }
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
