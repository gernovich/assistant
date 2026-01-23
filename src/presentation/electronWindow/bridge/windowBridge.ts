import type { RecordingStatsDto, RecordingVizDto } from "./windowBridgeContracts";
import type { WindowRequest, WindowResponse } from "./windowBridgeContracts";
import { WindowRequestSchema } from "../../../shared/validation/windowRequestResponseSchemas";

type IpcRendererLike = {
  on: (channel: string, cb: (e: { senderId?: number }, payload: unknown) => void) => void;
  removeListener: (channel: string, cb: (e: { senderId?: number }, payload: unknown) => void) => void;
  sendTo: (webContentsId: number, channel: string, payload: unknown) => void;
};

function tryGetIpcRenderer(): IpcRendererLike | null {
  // Tests can inject a fake ipc via globalThis (since `electron` module isn't available in vitest env).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const injected = (globalThis as any).__assistantElectronIpcMock as IpcRendererLike | undefined;
  // TS: избегаем проверки “function as boolean” (TS2774) — проверяем явно.
  if (injected && typeof injected.sendTo === "function" && typeof injected.on === "function") return injected;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require("electron") as any;
    const ipc = electron?.ipcRenderer;
    if (!ipc?.sendTo || !ipc?.on) return null;
    return ipc as IpcRendererLike;
  } catch {
    return null;
  }
}

export type WebContentsLike = {
  id?: number;
};

export type BrowserWindowLike = {
  webContents: WebContentsLike;
};

/**
 * Request/response bridge поверх Electron IPC `ipcRenderer.sendTo`.
 *
 * Семантика как у title-bridge:
 * - отправляем ack сразу
 * - выполняем action (fire-and-forget) с таймаутом; при ошибке шлём error response
 *
 * Важно: это renderer<->renderer transport, не требующий `ipcMain` handlers.
 */
export function installElectronIpcRequestBridge(params: {
  expectedSenderId: number;
  timeoutMs?: number;
  onRequest: (req: WindowRequest) => void | Promise<void>;
}): () => void {
  const ipc = tryGetIpcRenderer();
  const senderId = Number(params.expectedSenderId);
  if (!ipc || !Number.isFinite(senderId)) return () => undefined;

  const timeoutMs = Math.max(50, Math.floor(Number(params.timeoutMs ?? 3000)));
  const channel = "assistant/window/request";

  const handler = (e: { senderId?: number }, payload: unknown) => {
    const from = Number((e as any)?.senderId);
    if (!Number.isFinite(from) || from !== senderId) return;

    const parsed = WindowRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const badId = typeof (payload as any)?.id === "string" ? String((payload as any).id) : "";
      if (badId) {
        const resp: WindowResponse = {
          id: badId,
          ok: false,
          error: { code: "E_VALIDATION", message: "Ассистент: некорректный запрос окна" },
        };
        try {
          ipc.sendTo(from, "assistant/window/response", resp);
        } catch {
          // ignore
        }
      }
      return;
    }

    const req = parsed.data as WindowRequest;

    const okResp: WindowResponse = { id: req.id, ok: true };
    try {
      ipc.sendTo(from, "assistant/window/response", okResp);
    } catch {
      // ignore
    }

    void Promise.race([
      Promise.resolve().then(() => params.onRequest(req)),
      new Promise<void>((_, rej) => setTimeout(() => rej("timeout"), timeoutMs)),
    ]).catch((err) => {
      const resp: WindowResponse = {
        id: req.id,
        ok: false,
        error: { code: "E_TIMEOUT", message: "Ассистент: операция не успела завершиться", cause: String(err) },
      };
      try {
        ipc.sendTo(from, "assistant/window/response", resp);
      } catch {
        // ignore
      }
    });
  };

  ipc.on(channel, handler);
  return () => {
    try {
      ipc.removeListener(channel, handler);
    } catch {
      // ignore
    }
  };
}

export function pushRecordingStats(params: { win: BrowserWindowLike; stats: RecordingStatsDto }): void {
  const { win, stats } = params;
  const ipc = tryGetIpcRenderer();
  const wcId = Number(win.webContents?.id);
  if (!ipc || !Number.isFinite(wcId)) return;
  try {
    ipc.sendTo(wcId, "assistant/recording/stats", stats);
  } catch {
    // ignore
  }
}

export function pushRecordingViz(params: { win: BrowserWindowLike; viz: RecordingVizDto }): Promise<unknown> | null {
  const { win, viz } = params;
  const ipc = tryGetIpcRenderer();
  const wcId = Number(win.webContents?.id);
  if (!ipc || !Number.isFinite(wcId)) return null;
  try {
    ipc.sendTo(wcId, "assistant/recording/viz", viz);
    return Promise.resolve(undefined);
  } catch {
    return null;
  }
}
