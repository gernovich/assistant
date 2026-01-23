import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

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

// Модуль `electron` отсутствует в vitest-окружении, поэтому используем fallback-хук из кода:
// (globalThis as any).__assistantElectronMock
Object.defineProperty(globalThis as any, "__assistantElectronMock", { value: electronMock, configurable: true });

// IPC mock for windowBridge.ts: (globalThis as any).__assistantElectronIpcMock
const ipcHandlers = new Map<string, Handler>();
const ipcMock = {
  on: (channel: string, cb: Handler) => {
    ipcHandlers.set(String(channel), cb);
  },
  removeListener: (channel: string, cb: Handler) => {
    const ch = String(channel);
    if (ipcHandlers.get(ch) === cb) ipcHandlers.delete(ch);
  },
  sendTo: vi.fn(),
};
Object.defineProperty(globalThis as any, "__assistantElectronIpcMock", { value: ipcMock, configurable: true });

function cal(id: string) {
  return { id, name: id, type: "ics_url", config: { id, name: id, type: "ics_url", enabled: true } } as any;
}

describe("electronWindowReminder", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    createdWindows.length = 0;
    ipcHandlers.clear();
    ipcMock.sendTo.mockReset();
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

    showElectronReminderWindow({
      ev,
      kind: "before",
      minutesBefore: 5,
      actions: {},
    });

    const w = createdWindows[0];
    expect(w).toBeTruthy();
    expect(w.loadURL).toHaveBeenCalled();
    expect(String(w.loadedUrl)).toContain("data:text/html");

    const decoded = decodeURIComponent(String(w.loadedUrl).split(",").slice(1).join(","));
    expect(decoded).toContain("Ассистент: Напоминание");
    expect(decoded).toContain("assistant/window/request");
    expect(decoded).toContain("Через 02:00:00");

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

    showElectronReminderWindow({
      ev,
      kind: "before",
      minutesBefore: 5,
      actions: { createProtocol, startRecording, meetingCancelled },
    });
    const w = createdWindows[0];
    expect(w).toBeTruthy();

    const handler = ipcHandlers.get("assistant/window/request");
    expect(handler).toBeTypeOf("function");

    // start recording
    handler!({ senderId: w.webContents.id } as any, { id: "r1", ts: 1, action: { kind: "reminder.startRecording" } });
    await Promise.resolve();
    expect(startRecording).toHaveBeenCalledTimes(1);
    expect(w.close).toHaveBeenCalled();

    // Следующий запуск: "Создать протокол"
    showElectronReminderWindow({
      ev,
      kind: "before",
      minutesBefore: 5,
      actions: { createProtocol, startRecording, meetingCancelled },
    });
    const wProto = createdWindows[1];
    const handler2 = ipcHandlers.get("assistant/window/request");
    expect(handler2).toBeTypeOf("function");
    handler2!({ senderId: wProto.webContents.id } as any, { id: "r2", ts: 2, action: { kind: "reminder.createProtocol" } });
    await Promise.resolve();
    expect(createProtocol).toHaveBeenCalledTimes(1);

    // Следующий запуск: "Встреча отменена"
    showElectronReminderWindow({
      ev,
      kind: "before",
      minutesBefore: 5,
      actions: { createProtocol, startRecording, meetingCancelled },
    });
    const w2 = createdWindows[2];
    const handler3 = ipcHandlers.get("assistant/window/request");
    expect(handler3).toBeTypeOf("function");
    handler3!({ senderId: w2.webContents.id } as any, { id: "r3", ts: 3, action: { kind: "reminder.meetingCancelled" } });
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

    showElectronReminderWindow({ ev, kind: "before", minutesBefore: 5, actions: { startRecording } });
    const w = createdWindows[0];
    w.close.mockImplementation(() => {
      throw new Error("cannot close");
    });

    const handler = ipcHandlers.get("assistant/window/request");
    expect(handler).toBeTypeOf("function");
    handler!({ senderId: w.webContents.id } as any, { id: "r1", ts: 1, action: { kind: "reminder.startRecording" } });
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

  it("ipc: игнорирует запросы от другого senderId", async () => {
    const { showElectronReminderWindow } = await import("../src/notifications/electronWindowReminder");
    const ev = { calendar: cal("c"), id: "u", summary: "M", start: new Date(Date.now() + 60_000) };

    showElectronReminderWindow({ ev, kind: "before", minutesBefore: 5, actions: {} });
    const w = createdWindows[0];
    const handler = ipcHandlers.get("assistant/window/request");
    expect(handler).toBeTypeOf("function");
    handler!({ senderId: w.webContents.id + 999 } as any, { id: "x", ts: 1, action: { kind: "close" } });
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

  it("ipc: не падает и не закрывает окно на невалидный payload", async () => {
    const { showElectronReminderWindow } = await import("../src/notifications/electronWindowReminder");
    const ev = { calendar: cal("c"), id: "u", summary: "M", start: new Date(Date.now() + 60_000) };

    showElectronReminderWindow({ ev, kind: "before", minutesBefore: 5, actions: {} });
    const w = createdWindows[0];
    const handler = ipcHandlers.get("assistant/window/request");
    expect(handler).toBeTypeOf("function");
    handler!({ senderId: w.webContents.id } as any, { id: "bad", ts: "nope", action: { kind: "close" } });
    await Promise.resolve();
    expect(w.close).not.toHaveBeenCalled();
  });
});

