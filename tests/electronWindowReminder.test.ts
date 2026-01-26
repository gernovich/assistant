import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { TransportConfig, WindowTransport } from "../src/presentation/electronWindow/transport/windowTransport";

// ВАЖНО: electronWindowReminder внутри функции делает `require("electron")`,
// поэтому мокаем модуль ДО импорта tested module.

type Handler = (...args: any[]) => void;

class FakeWebContents extends EventEmitter {
  id: number;
  constructor(id: number) {
    super();
    this.id = id;
  }
}

class FakeBrowserWindow extends EventEmitter {
  public webContents: FakeWebContents;
  public loadedUrl: string | null = null;
  public closed = false;
  public shown = false;

  constructor(id: number) {
    super();
    this.webContents = new FakeWebContents(id);
  }

  setAlwaysOnTop = vi.fn();
  setOpacity = vi.fn();
  setPosition = vi.fn();
  show = vi.fn(() => {
    this.shown = true;
  });
  showInactive = vi.fn(() => {
    this.shown = true;
  });
  isDestroyed = vi.fn(() => false);
  loadURL = vi.fn(async (url: string) => {
    this.loadedUrl = url;
  });
  close = vi.fn(() => {
    this.closed = true;
    this.emit("closed");
  });
}

const createdWindows: FakeBrowserWindow[] = [];
// Конструктор (важно: используется как `new BrowserWindow(...)`)
function BrowserWindowCtor(this: unknown, _opts: unknown) {
  const id = 700 + createdWindows.length;
  const w = new FakeBrowserWindow(id);
  createdWindows.push(w);
  return w as any;
}

const electronMock = {
  BrowserWindow: BrowserWindowCtor as any,
  screen: {
    getPrimaryDisplay: () => ({ workArea: { width: 1000, height: 700 } }),
  },
};

const { MockTransport, existsSyncMock } = vi.hoisted(() => {
  const existsSyncMock = vi.fn((_path: string) => true);
  class MockTransport implements WindowTransport {
    attach(): void {
      // no-op
    }
    isReady(): boolean {
      return true;
    }
    onReady(cb: () => void): () => void {
      cb();
      return () => undefined;
    }
    send(): void {
      // no-op
    }
    onMessage(): () => void {
      return () => undefined;
    }
    close(): void {
      // no-op
    }
    getConfig(): TransportConfig | null {
      return { type: "ws", url: "ws://127.0.0.1:0/assistant-dialog" };
    }
    getCspConnectSrc(): string[] | null {
      return ["ws://127.0.0.1:*"];
    }
  }
  return { MockTransport, existsSyncMock };
});

vi.mock("../src/presentation/electronWindow/transport/transportFactory", () => ({
  createDialogTransport: () => new MockTransport(),
}));

vi.mock("node:fs", () => ({
  existsSync: (path: string) => existsSyncMock(path),
}));

// Модуль `electron` отсутствует в vitest-окружении, поэтому используем fallback-хук из кода:
// (globalThis as any).__assistantElectronMock
Object.defineProperty(globalThis as any, "__assistantElectronMock", { value: electronMock, configurable: true });

class FakeTransport implements WindowTransport {
  public sent: any[] = [];
  private readyCbs: Array<() => void> = [];
  private messageCbs: Array<(payload: unknown) => void> = [];

  attach(): void {
    // no-op
  }

  isReady(): boolean {
    return true;
  }

  onReady(cb: () => void): () => void {
    this.readyCbs.push(cb);
    cb();
    return () => {
      const i = this.readyCbs.indexOf(cb);
      if (i >= 0) this.readyCbs.splice(i, 1);
    };
  }

  send(payload: unknown): void {
    this.sent.push(payload);
  }

  onMessage(cb: (payload: unknown) => void): () => void {
    this.messageCbs.push(cb);
    return () => {
      const i = this.messageCbs.indexOf(cb);
      if (i >= 0) this.messageCbs.splice(i, 1);
    };
  }

  close(): void {
    // no-op
  }

  getConfig(): TransportConfig | null {
    return { type: "ws", url: "ws://127.0.0.1:12345/assistant-dialog" };
  }

  getCspConnectSrc(): string[] | null {
    return ["ws://127.0.0.1:*"];
  }

  emit(payload: unknown): void {
    for (const cb of this.messageCbs) cb(payload);
  }
}

function cal(id: string) {
  return { id, name: id, type: "ics_url", config: { id, name: id, type: "ics_url", enabled: true } } as any;
}

describe("electronWindowReminder", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    createdWindows.length = 0;
    existsSyncMock.mockReset();
    existsSyncMock.mockReturnValue(true);
  });

  it("создаёт окно и грузит data-url с ожидаемыми кнопками", async () => {
    const { showElectronReminderWindow } = await import("../src/notifications/electronWindowReminder");

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const ev = {
      calendar: cal("c"),
      id: "u",
      summary: "M",
      start: new Date("2026-01-01T02:00:00.000Z"), // diff=2h -> HH:MM:SS
      end: new Date("2026-01-01T11:00:00.000Z"),
    };

    const onLog = vi.fn();
    existsSyncMock.mockReturnValue(false);
    showElectronReminderWindow({
      ev,
      kind: "before",
      minutesBefore: 5,
      actions: {},
      onLog,
    });

    const w = createdWindows[0];
    expect(w).toBeTruthy();
    expect(w.loadURL).toHaveBeenCalled();
    expect(String(w.loadedUrl)).toContain("data:text/html");

    const decoded = decodeURIComponent(String(w.loadedUrl).split(",").slice(1).join(","));
    expect(decoded).toContain("Ассистент: Напоминание");
    expect(decoded).toContain("window/request");
    expect(decoded).toContain("window/response");
    expect(decoded).toContain("Через 02:00:00");
    expect(onLog).toHaveBeenCalledWith(
      `Напоминание: preload файл не найден: /home/gernovich/projects/_tests/assistant/src/notifications/bridge-preload.cjs`,
    );
    expect(onLog).toHaveBeenCalledWith(
      `Напоминание: pluginDirPath: не передан, __dirname: /home/gernovich/projects/_tests/assistant/src/notifications`,
    );

    vi.useRealTimers();
  });

  it("форматирует countdown >= 24 часа как 'D дней HH:MM:SS'", async () => {
    const { showElectronReminderWindow } = await import("../src/notifications/electronWindowReminder");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const ev = {
      calendar: cal("c"),
      id: "u",
      summary: "Long",
      start: new Date("2026-01-02T06:00:00.000Z"), // 30h -> "1 дней 06:00:00"
    };

    showElectronReminderWindow({ ev, kind: "before", minutesBefore: 0, actions: {} });
    const w = createdWindows[0];
    const decoded = decodeURIComponent(String(w.loadedUrl).split(",").slice(1).join(","));
    expect(decoded).toContain("Через 1 дней 06:00:00");
    vi.useRealTimers();
  });

  it("по Electron IPC request вызывает нужный action и закрывает окно", async () => {
    vi.useFakeTimers();
    const { showElectronReminderWindow } = await import("../src/notifications/electronWindowReminder");

    const createProtocol = vi.fn(async () => undefined);
    const startRecording = vi.fn(async () => undefined);
    const meetingCancelled = vi.fn(async () => undefined);

    const ev = {
      calendar: cal("c"),
      id: "u",
      summary: "M",
      start: new Date("2026-01-01T10:00:00.000Z"),
      end: new Date("2026-01-01T11:00:00.000Z"),
    };

    const transport = new FakeTransport();
    const transportRegistry = { createDialogTransport: () => transport } as any;
    showElectronReminderWindow({
      ev,
      kind: "before",
      minutesBefore: 5,
      actions: { createProtocol, startRecording, meetingCancelled },
      transportRegistry,
    });
    const w = createdWindows[0];
    expect(w).toBeTruthy();

    // start recording
    transport.emit({ type: "window/request", payload: { id: "r1", ts: 1, action: { kind: "reminder.startRecording" } } });
    await Promise.resolve();
    expect(startRecording).toHaveBeenCalledTimes(1);
    expect(w.close).toHaveBeenCalled();

    // Следующий запуск: "Создать протокол"
    const transport2 = new FakeTransport();
    const transportRegistry2 = { createDialogTransport: () => transport2 } as any;
    showElectronReminderWindow({
      ev,
      kind: "before",
      minutesBefore: 5,
      actions: { createProtocol, startRecording, meetingCancelled },
      transportRegistry: transportRegistry2,
    });
    const wProto = createdWindows[1];
    transport2.emit({ type: "window/request", payload: { id: "r2", ts: 2, action: { kind: "reminder.createProtocol" } } });
    await Promise.resolve();
    expect(createProtocol).toHaveBeenCalledTimes(1);

    // Следующий запуск: "Встреча отменена"
    const transport3 = new FakeTransport();
    const transportRegistry3 = { createDialogTransport: () => transport3 } as any;
    showElectronReminderWindow({
      ev,
      kind: "before",
      minutesBefore: 5,
      actions: { createProtocol, startRecording, meetingCancelled },
      transportRegistry: transportRegistry3,
    });
    const w2 = createdWindows[2];
    transport3.emit({ type: "window/request", payload: { id: "r3", ts: 3, action: { kind: "reminder.meetingCancelled" } } });
    await Promise.resolve();
    expect(meetingCancelled).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("автозакрытие по таймеру закрывает окно", async () => {
    vi.useFakeTimers();
    const { showElectronReminderWindow } = await import("../src/notifications/electronWindowReminder");

    const ev = {
      calendar: cal("c"),
      id: "u",
      summary: "M",
      start: new Date(Date.now() + 60_000),
    };

    showElectronReminderWindow({
      ev,
      kind: "before",
      minutesBefore: 5,
      actions: {},
    });

    const w = createdWindows[0];
    expect(w).toBeTruthy();
    expect(w.close).not.toHaveBeenCalled();

    // timeoutMs в реализации = 25_000
    vi.advanceTimersByTime(25_000);
    expect(w.close).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("ready-to-show: если showInactive падает, делаем fallback на show()", async () => {
    const { showElectronReminderWindow } = await import("../src/notifications/electronWindowReminder");
    const ev = { calendar: cal("c"), id: "u", summary: "M", start: new Date(Date.now() + 60_000) };

    showElectronReminderWindow({ ev, kind: "before", minutesBefore: 5, actions: {} });
    const w = createdWindows[0];
    w.showInactive.mockImplementation(() => {
      throw new Error("no showInactive");
    });

    w.emit("ready-to-show");
    expect(w.show).toHaveBeenCalled();
  });

  it("не падает, если setAlwaysOnTop/setOpacity/setPosition бросают (try/catch ветки)", async () => {
    // Переопределяем BrowserWindow на время теста, чтобы методы бросали сразу при создании.
    const prev = (electronMock as any).BrowserWindow;
    (electronMock as any).BrowserWindow = function BrowserWindowThrowing(this: unknown, _opts: unknown) {
      const w = new FakeBrowserWindow(999);
      w.setAlwaysOnTop.mockImplementation(() => {
        throw new Error("no always-on-top");
      });
      w.setOpacity.mockImplementation(() => {
        throw new Error("no opacity");
      });
      w.setPosition.mockImplementation(() => {
        throw new Error("no position");
      });
      createdWindows.push(w);
      return w as any;
    };

    try {
      const { showElectronReminderWindow } = await import("../src/notifications/electronWindowReminder");
      const ev = { calendar: cal("c"), id: "u", summary: "M", start: new Date(Date.now() + 60_000) };
      showElectronReminderWindow({ ev, kind: "before", minutesBefore: 5, actions: {} });
      expect(createdWindows[0]).toBeTruthy();
    } finally {
      (electronMock as any).BrowserWindow = prev;
    }
  });

  it("таймер автозакрытия: если окно уже уничтожено, не пытаемся закрывать", async () => {
    vi.useFakeTimers();
    const { showElectronReminderWindow } = await import("../src/notifications/electronWindowReminder");
    const ev = { calendar: cal("c"), id: "u", summary: "M", start: new Date(Date.now() + 60_000) };

    showElectronReminderWindow({ ev, kind: "before", minutesBefore: 5, actions: {} });
    const w = createdWindows[0];
    w.isDestroyed.mockReturnValue(true);

    vi.advanceTimersByTime(25_000);
    expect(w.close).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("onAction: если close() бросает, action всё равно выполняется и не падаем", async () => {
    const { showElectronReminderWindow } = await import("../src/notifications/electronWindowReminder");
    const startRecording = vi.fn(async () => undefined);
    const ev = { calendar: cal("c"), id: "u", summary: "M", start: new Date("2026-01-01T10:00:00.000Z") };

    const transport = new FakeTransport();
    const transportRegistry = { createDialogTransport: () => transport } as any;
    showElectronReminderWindow({ ev, kind: "before", minutesBefore: 5, actions: { startRecording }, transportRegistry });
    const w = createdWindows[0];
    w.close.mockImplementation(() => {
      throw new Error("cannot close");
    });

    transport.emit({ type: "window/request", payload: { id: "r1", ts: 1, action: { kind: "reminder.startRecording" } } });
    await Promise.resolve();
    expect(startRecording).toHaveBeenCalledTimes(1);
    expect(w.close).toHaveBeenCalled();
  });

  it("таймер автозакрытия: если isDestroyed() бросает, не падаем", async () => {
    vi.useFakeTimers();
    const { showElectronReminderWindow } = await import("../src/notifications/electronWindowReminder");
    const ev = { calendar: cal("c"), id: "u", summary: "M", start: new Date(Date.now() + 60_000) };

    showElectronReminderWindow({ ev, kind: "before", minutesBefore: 5, actions: {} });
    const w = createdWindows[0];
    w.isDestroyed.mockImplementation(() => {
      throw new Error("boom");
    });

    vi.advanceTimersByTime(25_000);
    expect(w.close).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("transport: игнорирует некорректный payload", async () => {
    const { showElectronReminderWindow } = await import("../src/notifications/electronWindowReminder");
    const ev = { calendar: cal("c"), id: "u", summary: "M", start: new Date(Date.now() + 60_000) };

    const transport = new FakeTransport();
    const transportRegistry = { createDialogTransport: () => transport } as any;
    showElectronReminderWindow({ ev, kind: "before", minutesBefore: 5, actions: {}, transportRegistry });
    const w = createdWindows[0];
    transport.emit({ type: "window/request", payload: { id: "x", ts: "bad", action: { kind: "close" } } });
    await Promise.resolve();
    expect(w.close).not.toHaveBeenCalled();
  });

  it("minutesBefore: если NaN, в html попадает 0 (ветка Number.isFinite)", async () => {
    const { showElectronReminderWindow } = await import("../src/notifications/electronWindowReminder");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const ev = { calendar: cal("c"), id: "u", summary: "M", start: new Date("2026-01-01T00:10:00.000Z") };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    showElectronReminderWindow({ ev, kind: "before", minutesBefore: Number.NaN as any, actions: {} });
    const w = createdWindows[0];
    const decoded = decodeURIComponent(String(w.loadedUrl).split(",").slice(1).join(","));
    expect(decoded).toContain("const minutesBefore = 0");
    vi.useRealTimers();
  });

  it("использует electron.remote.BrowserWindow, если он задан (ветка ??)", async () => {
    // Временно подменяем electronMock: убираем BrowserWindow и выставляем remote.BrowserWindow
    const prevBrowserWindow = (electronMock as any).BrowserWindow;
    const prevRemote = (electronMock as any).remote;
    (electronMock as any).BrowserWindow = undefined;
    (electronMock as any).remote = { BrowserWindow: BrowserWindowCtor };

    try {
      const { showElectronReminderWindow } = await import("../src/notifications/electronWindowReminder");
      const ev = { calendar: cal("c"), id: "u", summary: "Remote", start: new Date(Date.now() + 60_000) };
      showElectronReminderWindow({ ev, kind: "before", minutesBefore: 5, actions: {} });
      expect(createdWindows[0]).toBeTruthy();
    } finally {
      (electronMock as any).BrowserWindow = prevBrowserWindow;
      (electronMock as any).remote = prevRemote;
    }
  });

  it("summary может быть undefined/null (через any) и не ломает генерацию html", async () => {
    const { showElectronReminderWindow } = await import("../src/notifications/electronWindowReminder");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ev: any = { calendar: cal("c"), id: "u", summary: undefined, start: new Date("2026-01-01T00:10:00.000Z") };
    showElectronReminderWindow({ ev, kind: "before", minutesBefore: 5, actions: {} });
    const w = createdWindows[0];
    const decoded = decodeURIComponent(String(w.loadedUrl).split(",").slice(1).join(","));
    expect(decoded).toContain("meetingTitle");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ev2: any = { calendar: cal("c"), id: "u2", summary: null, start: new Date("2026-01-01T00:10:00.000Z") };
    showElectronReminderWindow({ ev: ev2, kind: "before", minutesBefore: 5, actions: {} });
    const w2 = createdWindows[1];
    const decoded2 = decodeURIComponent(String(w2.loadedUrl).split(",").slice(1).join(","));
    expect(decoded2).toContain("meetingTitle");

    vi.useRealTimers();
  });

  it("transport: не падает и не закрывает окно на невалидный payload", async () => {
    const { showElectronReminderWindow } = await import("../src/notifications/electronWindowReminder");
    const ev = { calendar: cal("c"), id: "u", summary: "M", start: new Date(Date.now() + 60_000) };

    const transport = new FakeTransport();
    const transportRegistry = { createDialogTransport: () => transport } as any;
    showElectronReminderWindow({ ev, kind: "before", minutesBefore: 5, actions: {}, transportRegistry });
    const w = createdWindows[0];
    transport.emit({ type: "window/request", payload: { id: "bad", ts: "nope", action: { kind: "close" } } });
    await Promise.resolve();
    expect(w.close).not.toHaveBeenCalled();
  });
});
