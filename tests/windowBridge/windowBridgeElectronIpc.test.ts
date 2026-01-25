import { describe, expect, it, vi } from "vitest";
import { installElectronIpcRequestBridge, pushRecordingStats } from "../../src/presentation/electronWindow/bridge/windowBridge";

describe("windowBridge (electron ipc transport)", () => {
  it("pushRecordingStats предпочитает ipcRenderer.sendTo когда доступен", () => {
    const sendTo = vi.fn();
    (globalThis as any).__assistantElectronIpcMock = {
      on: vi.fn(),
      removeListener: vi.fn(),
      sendTo,
    };

    const exec = vi.fn(async () => undefined);
    pushRecordingStats({
      win: { webContents: { on: vi.fn() as any, executeJavaScript: exec, id: 123 } } as any,
      stats: { status: "idle", filesTotal: 1, filesRecognized: 2 } as any,
    });

    expect(sendTo).toHaveBeenCalledTimes(1);
    expect(sendTo).toHaveBeenCalledWith(123, "assistant/recording/stats", expect.any(Object));
    expect(exec).toHaveBeenCalledTimes(0);
  });

  it("installElectronIpcRequestBridge: валидирует payload (WindowRequestSchema) и шлёт ack ok=true", async () => {
    const handlers = new Map<string, (e: any, payload: unknown) => void>();
    const sendTo = vi.fn();
    const on = vi.fn((ch: string, cb: any) => handlers.set(ch, cb));
    const removeListener = vi.fn((ch: string) => handlers.delete(ch));

    (globalThis as any).__assistantElectronIpcMock = { on, removeListener, sendTo };

    const onRequest = vi.fn(async () => undefined);
    const un = installElectronIpcRequestBridge({
      expectedSenderId: 777,
      timeoutMs: 200,
      onRequest,
    });

    const h = handlers.get("assistant/window/request");
    expect(h).toBeTruthy();

    // Тестовый мок использует формат (e: { senderId }, payload)
    h?.({ senderId: 777 }, { id: "r1", ts: Date.now(), action: { kind: "close" } });

    expect(sendTo).toHaveBeenCalledWith(777, "assistant/window/response", { id: "r1", ok: true });
    // onRequest вызывается асинхронно (через Promise.resolve().then(...))
    await Promise.resolve();
    await Promise.resolve();
    expect(onRequest).toHaveBeenCalledTimes(1);

    un();
    expect(removeListener).toHaveBeenCalled();
  });
});
