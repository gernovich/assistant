import type { RecordingStatsDto, RecordingVizDto } from "./windowBridgeContracts";
import type { WindowRequest, WindowResponse } from "./windowBridgeContracts";
import { WindowRequestSchema } from "../../../shared/validation/windowRequestResponseSchemas";

type IpcRendererLike = {
  on: (channel: string, cb: (event: any, ...args: unknown[]) => void) => void;
  removeListener: (channel: string, cb: (event: any, ...args: unknown[]) => void) => void;
  sendTo: (webContentsId: number, channel: string, payload: unknown) => void;
};

function tryGetIpcRenderer(): IpcRendererLike | null {
  // В тестах можно подставить фейковый ipc через globalThis (модуля `electron` нет в vitest).
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
 * Мост запрос/ответ поверх Electron IPC `ipcRenderer.sendTo`.
 *
 * Семантика как у title-bridge:
 * - сразу отправляем подтверждение (ack)
 * - выполняем действие (fire-and-forget) с таймаутом; при ошибке шлём ответ об ошибке
 *
 * Важно: это транспорт renderer<->renderer, не требующий обработчиков `ipcMain`.
 */
export function installElectronIpcRequestBridge(params: {
  expectedSenderId: number;
  timeoutMs?: number;
  onRequest: (req: WindowRequest) => void | Promise<void>;
  onLog?: (message: string) => void;
}): () => void {
  const ipc = tryGetIpcRenderer();
  const senderId = Number(params.expectedSenderId);
  if (!ipc || !Number.isFinite(senderId)) return () => undefined;

  const timeoutMs = Math.max(50, Math.floor(Number(params.timeoutMs ?? 3000)));
  const channel = "assistant/window/request";
  const log = (message: string) => params.onLog?.(message);

  const handler = (eventOrSender: any, payloadOrArg?: unknown, ...restArgs: unknown[]) => {
    // Поддержка двух форматов:
    // 1. Тестовый мок: (e: { senderId?: number }, payload: unknown)
    // 2. Реальный Electron: (event, payload, ...args), где event.sender.id содержит senderId

    let payload: unknown;
    let from: number;

    // Проверяем, является ли первый аргумент объектом с senderId (тестовый мок)
    if (eventOrSender && typeof eventOrSender === "object" && "senderId" in eventOrSender && payloadOrArg !== undefined) {
      // Формат тестового мока: (e: { senderId }, payload)
      from = Number((eventOrSender as any).senderId ?? 0);
      payload = payloadOrArg;
    } else {
      // Формат реального Electron: (event, payload, ...args)
      // payload идет как второй аргумент (или первый, если event не содержит sender)
      payload = payloadOrArg ?? (restArgs.length > 0 ? restArgs[0] : undefined);

      // Получаем senderId из event.sender.id или event.senderId
      from = Number((eventOrSender as any)?.sender?.id ?? (eventOrSender as any)?.senderId ?? (eventOrSender as any)?.id ?? 0);
    }

    // Диагностика — только через onLog (без console).
    log("windowBridge: событие получено");
    log(`windowBridge: expectedSenderId=${senderId}, from=${from}`);

    if (!Number.isFinite(from) || from !== senderId) {
      log(`windowBridge: сообщение отклонено (from=${from}, expected=${senderId})`);
      return;
    }

    if (!payload) {
      log("windowBridge: payload отсутствует");
      return;
    }

    log("windowBridge: сообщение принято");
    const parsed = WindowRequestSchema.safeParse(payload);
    if (!parsed.success) {
      log("windowBridge: payload невалиден");
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
          // Игнорируем ошибки отправки ответа.
        }
      }
      return;
    }

    const req = parsed.data as WindowRequest;

    const okResp: WindowResponse = { id: req.id, ok: true };
    try {
      ipc.sendTo(from, "assistant/window/response", okResp);
    } catch {
      // Игнорируем ошибки отправки подтверждения.
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
        // Игнорируем ошибки отправки ответа об ошибке.
      }
    });
  };

  ipc.on(channel, handler);
  return () => {
    try {
      ipc.removeListener(channel, handler);
    } catch {
      // Игнорируем ошибки снятия слушателя.
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
    // Игнорируем ошибки отправки статистики.
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

export function pushTestMessage(params: { win: BrowserWindowLike; message: string; onLog?: (message: string) => void }): void {
  const { win, message } = params;
  const ipc = tryGetIpcRenderer();
  const wcId = Number(win.webContents?.id);
  const log = params.onLog;
  log?.(`pushTestMessage: отправка "${message}" в webContents id: ${wcId}, ipc доступен: ${!!ipc}`);
  if (!ipc || !Number.isFinite(wcId)) {
    log?.(`pushTestMessage: не могу отправить (ipc=${!!ipc}, wcId=${wcId})`);
    return;
  }
  try {
    const payload = { message, ts: Date.now() };
    log?.("pushTestMessage: отправляю payload");
    ipc.sendTo(wcId, "assistant/test/message", payload);
    log?.("pushTestMessage: сообщение отправлено");
  } catch (e) {
    log?.(`pushTestMessage: ошибка при отправке: ${e}`);
  }
}
