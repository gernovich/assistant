import { buildTestDialogHtml } from "./testDialogHtml";
import { createDialogTransport } from "../transport/transportFactory";
import type { WindowTransport } from "../transport/windowTransport";
import type { WindowTransportMessage } from "../bridge/windowBridgeContracts";
import { installWindowTransportRequestBridge } from "../bridge/windowTransportBridge";
import type { TransportRegistry } from "../transport/transportRegistry";
import path from "path";
import fs from "fs";

type ElectronLike = {
  remote?: { BrowserWindow?: any };
  BrowserWindow?: any;
  ipcRenderer?: any;
  screen?: { getPrimaryDisplay?: () => { workArea?: { width: number; height: number } } };
};

export type TestDialogWindow = {
  win: any;
  close: () => void;
  sendMessage: (message: string) => void;
};

let testDialogWindow: TestDialogWindow | null = null;

export function openTestDialog(params: {
  /** Абсолютный путь к директории плагина (для preload скрипта). */
  pluginDirPath?: string | null;
  /** Callback для обработки сообщений от диалога. */
  onMessage?: (action: { kind: string }) => void;
  transportRegistry?: TransportRegistry;
}): TestDialogWindow | null {
  const { pluginDirPath, onMessage } = params;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let electron: ElectronLike | undefined;
  try {
    electron = require("electron") as ElectronLike;
  } catch {
    return null;
  }

  const BrowserWindow = electron?.BrowserWindow ?? electron?.remote?.BrowserWindow;
  if (!BrowserWindow) {
    console.error("[Assistant] TestDialog: BrowserWindow недоступен");
    return null;
  }
  const ipcRenderer = (electron as any)?.ipcRenderer;

  // Host webContentsId (Obsidian renderer)
  let hostWebContentsId = 0;
  try {
    if ((electron as any)?.remote?.getCurrentWebContents) {
      const wc = (electron as any).remote.getCurrentWebContents();
      if (wc?.id) {
        hostWebContentsId = Number(wc.id);
      }
    }

    if (hostWebContentsId === 0 && ipcRenderer) {
      if (typeof (ipcRenderer as any).senderId === "number") {
        hostWebContentsId = Number((ipcRenderer as any).senderId);
      } else if (typeof (ipcRenderer as any)._senderId === "number") {
        hostWebContentsId = Number((ipcRenderer as any)._senderId);
      }
    }

    if (hostWebContentsId === 0) {
      console.warn("[Assistant] TestDialog: не удалось определить hostWebContentsId");
    }
  } catch (e) {
    console.warn(`[Assistant] TestDialog: ошибка при определении hostWebContentsId: ${e}`);
    hostWebContentsId = 0;
  }

  const html = buildTestDialogHtml({
    hostWebContentsId,
  });

  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

  const preloadPath = pluginDirPath ? path.join(pluginDirPath, "bridge-preload.cjs") : undefined;
  if (preloadPath) {
    const exists = fs.existsSync(preloadPath);
    console.log(`[Assistant] TestDialog: preload path: ${preloadPath} (exists: ${exists})`);
    if (!exists) {
      console.warn("[Assistant] TestDialog: preload file не найден, __assistantElectron не будет доступен");
    }
  } else {
    console.warn("[Assistant] TestDialog: pluginDirPath не задан, preload не будет подключен");
  }

  const win = new BrowserWindow({
    width: 500,
    height: 600,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
  });

  void win.loadURL(url);

  const transport: WindowTransport = params.transportRegistry
    ? params.transportRegistry.createDialogTransport({ webContents: win.webContents, hostWebContentsId })
    : createDialogTransport();

  transport.attach();
  transport.onReady(() => {
    console.log("[Assistant] TestDialog: transport готов");
  });
  const unSub = installWindowTransportRequestBridge({
    transport,
    timeoutMs: 2000,
    onRequest: async (req) => {
      if (req.action?.kind === "close") {
        close();
        return;
      }
      if (onMessage) onMessage(req.action);
    },
  });

  const close = () => {
    try {
      if (win && !win.isDestroyed()) {
        win.close();
      }
    } catch {
      // ignore
    }
    testDialogWindow = null;
  };

  const sendMessage = (message: string) => {
    if (!win || win.isDestroyed()) {
      console.warn("[Assistant] TestDialog: окно закрыто, нельзя отправить сообщение");
      return;
    }

    try {
      const payload: WindowTransportMessage = { type: "test/message", payload: { message, ts: Date.now() } };
      transport.send(payload);
    } catch (e) {
      console.error("[Assistant] TestDialog: ошибка при отправке через transport:", e);
    }
  };

  // Cleanup
  let cleanupCalled = false;
  const doCleanup = () => {
    if (cleanupCalled) return;
    cleanupCalled = true;
    try {
      unSub();
      transport.close();
    } catch (e) {
      console.warn(`[Assistant] TestDialog: ошибка при cleanup: ${e}`);
    }
  };

  win.on("close", () => {
    doCleanup();
  });

  win.on("closed", () => {
    doCleanup();
    testDialogWindow = null;
  });

  win.once("ready-to-show", () => {
    try {
      win.show();
    } catch {
      // ignore
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
      // ignore
    }
  };

  transport.onReady(() => trySendConfig());
  win.webContents.once("did-finish-load", () => {
    dialogLoaded = true;
    trySendConfig();
  });

  testDialogWindow = { win, close, sendMessage };
  return testDialogWindow;
}
