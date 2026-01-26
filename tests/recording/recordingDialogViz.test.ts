import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingController } from "../../src/presentation/controllers/recordingController";
import type { RecordingStats } from "../../src/recording/recordingService";
import type { WindowTransport, TransportMessage, TransportConfig } from "../../src/presentation/electronWindow/transport/windowTransport";
import { DEFAULT_SETTINGS } from "../../src/settingsStore";

type MockListener = (...args: any[]) => void;

class MockWebContents {
  private listeners = new Map<string, MockListener[]>();
  send = vi.fn();

  once(event: string, cb: MockListener) {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
  }

  emit(event: string, ...args: any[]) {
    const list = this.listeners.get(event) ?? [];
    this.listeners.delete(event);
    for (const cb of list) cb(...args);
  }
}

class MockBrowserWindow {
  webContents = new MockWebContents();
  private listeners = new Map<string, MockListener[]>();

  constructor() {}

  loadURL = vi.fn(() => {
    this.webContents.emit("did-finish-load");
    this.emit("ready-to-show");
  });

  setAlwaysOnTop() {}
  setOpacity() {}
  setPosition() {}
  show() {}

  close = vi.fn(() => {
    this.emit("close");
    this.emit("closed");
  });

  on(event: string, cb: MockListener) {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
  }

  once(event: string, cb: MockListener) {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
  }

  emit(event: string, ...args: any[]) {
    const list = this.listeners.get(event) ?? [];
    if (event === "close" || event === "closed" || event === "ready-to-show") {
      this.listeners.delete(event);
    }
    for (const cb of list) cb(...args);
  }
}

class MockTransport implements WindowTransport {
  private ready = false;
  private readyCallbacks = new Set<() => void>();
  private messageCallbacks = new Set<(payload: TransportMessage) => void>();
  sent: TransportMessage[] = [];

  attach() {
    this.ready = true;
    for (const cb of this.readyCallbacks) cb();
  }

  isReady(): boolean {
    return this.ready;
  }

  onReady(cb: () => void) {
    this.readyCallbacks.add(cb);
    if (this.ready) cb();
    return () => this.readyCallbacks.delete(cb);
  }

  send(payload: TransportMessage) {
    this.sent.push(payload);
  }

  onMessage(cb: (payload: TransportMessage) => void) {
    this.messageCallbacks.add(cb);
    return () => this.messageCallbacks.delete(cb);
  }

  emitMessage(payload: TransportMessage) {
    for (const cb of this.messageCallbacks) cb(payload);
  }

  close() {}

  getConfig(): TransportConfig | null {
    return { type: "ws", url: "ws://127.0.0.1:1234/assistant-dialog" };
  }

  getCspConnectSrc(): string[] | null {
    return ["ws://127.0.0.1:*"];
  }
}

Object.defineProperty(globalThis as any, "__assistantElectronMock", {
  value: {
    BrowserWindow: MockBrowserWindow,
    screen: {
      getPrimaryDisplay: () => ({ workArea: { width: 1200, height: 900 } }),
    },
  },
  configurable: true,
});

describe("RecordingDialog визуализация", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as any).window = globalThis as any;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("не шлёт viz на паузе и очищает при idle", async () => {
    const transport = new MockTransport();
    const transportRegistry = {
      createDialogTransport: () => transport,
    } as any;

    let onViz: ((amp01: number) => void) | undefined;
    let onStats: ((s: RecordingStats) => void) | undefined;

    const stats: RecordingStats = { status: "idle", filesTotal: 0, filesRecognized: 0 };
    const okResult = { ok: true as const, value: undefined };
    const recordingController: RecordingController = {
      setOnStats: (cb) => {
        onStats = cb;
      },
      setOnViz: (cb) => {
        onViz = cb;
      },
      getStats: () => stats,
      start: async () => undefined,
      startResult: async () => okResult,
      stop: async () => undefined,
      stopResult: async () => okResult,
      pause: async () => undefined,
      pauseResult: async () => okResult,
      resume: async () => undefined,
      resumeResult: async () => okResult,
    };

    const { RecordingDialog } = await import("../../src/recording/recordingDialog");
    const dialog = new RecordingDialog({
      settings: { ...DEFAULT_SETTINGS },
      events: [],
      defaultCreateNewProtocol: false,
      recordingController,
      transportRegistry,
    });

    dialog.open();

    stats.status = "recording";
    onViz?.(1);
    vi.advanceTimersByTime(40);
    const sentBeforePause = transport.sent.filter((m) => (m as any).type === "recording/viz").length;
    expect(sentBeforePause).toBeGreaterThan(0);
    const hasStartClear = transport.sent.some((m) => (m as any).type === "recording/viz-clear");
    expect(hasStartClear).toBe(true);

    stats.status = "paused";
    vi.advanceTimersByTime(40);
    const sentAfterPause = transport.sent.filter((m) => (m as any).type === "recording/viz").length;
    expect(sentAfterPause).toBe(sentBeforePause);

    stats.status = "recording";
    onViz?.(0.5);
    vi.advanceTimersByTime(120);
    const sentAfterResume = transport.sent.filter((m) => (m as any).type === "recording/viz").length;
    expect(sentAfterResume).toBeGreaterThan(sentAfterPause);

    stats.status = "idle";
    vi.advanceTimersByTime(40);
    const hasVizClear = transport.sent.some((m) => (m as any).type === "recording/viz-clear");
    expect(hasVizClear).toBe(true);

    void onStats;
  });
});
