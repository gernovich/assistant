import { describe, expect, it, vi } from "vitest";
import { pushRecordingStats, pushRecordingViz } from "../../src/presentation/electronWindow/bridge/windowBridge";

describe("windowBridge (push)", () => {
  it("pushRecordingStats шлёт через Electron IPC (assistant/recording/stats)", () => {
    const sendTo = vi.fn();
    Object.defineProperty(globalThis as any, "__assistantElectronIpcMock", {
      value: { on: vi.fn(), removeListener: vi.fn(), sendTo },
      configurable: true,
    });
    pushRecordingStats({
      win: { webContents: { id: 123 } } as any,
      stats: { status: "idle", filesTotal: 1, filesRecognized: 2 } as any,
    });
    expect(sendTo).toHaveBeenCalledTimes(1);
    expect(sendTo).toHaveBeenCalledWith(123, "assistant/recording/stats", { status: "idle", filesTotal: 1, filesRecognized: 2 });
  });

  it("pushRecordingViz шлёт через Electron IPC (assistant/recording/viz) и возвращает Promise.resolve", async () => {
    const sendTo = vi.fn();
    Object.defineProperty(globalThis as any, "__assistantElectronIpcMock", {
      value: { on: vi.fn(), removeListener: vi.fn(), sendTo },
      configurable: true,
    });
    const p = pushRecordingViz({
      win: { webContents: { id: 321 } } as any,
      viz: { amp01: 0.5 },
    });
    expect(sendTo).toHaveBeenCalledTimes(1);
    expect(sendTo).toHaveBeenCalledWith(321, "assistant/recording/viz", { amp01: 0.5 });
    await expect(p).resolves.toBeUndefined();
  });
});

