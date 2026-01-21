import { describe, expect, it, vi } from "vitest";
import { LogFileWriter } from "../src/log/logFileWriter";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Module from "node:module";

async function mkTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "assistant-logwriter-"));
}

describe("LogFileWriter", () => {
  it("flush группирует записи по дате и пишет в соответствующий файл", async () => {
    const tmp = await mkTempDir();
    const app = { vault: {}, workspace: {} } as any;
    // В этом тесте нам важно содержимое файлов; отключаем “удаление старого” большой ретенцией.
    const w = new LogFileWriter({ app, logsDirPath: tmp, retentionDays: 365 });

    w.enqueue({ ts: new Date("2026-01-01T10:00:00.000Z").getTime(), level: "info", message: "a" });
    w.enqueue({ ts: new Date("2026-01-01T11:00:00.000Z").getTime(), level: "warn", message: "b" });
    w.enqueue({ ts: new Date("2026-01-02T10:00:00.000Z").getTime(), level: "error", message: "c" });

    await w.flush();

    const f1 = await fs.readFile(path.join(tmp, "2026-01-01.log"), "utf-8");
    const f2 = await fs.readFile(path.join(tmp, "2026-01-02.log"), "utf-8");
    expect(f1).toContain("2026-01-01T10:00:00.000Z INFO a");
    expect(f1).toContain("2026-01-01T11:00:00.000Z WARN b");
    expect(f2).toContain("2026-01-02T10:00:00.000Z ERROR c");
  });

  it("flush без pending ничего не делает", async () => {
    const tmp = await mkTempDir();
    const app = { vault: {}, workspace: {} } as any;
    const w = new LogFileWriter({ app, logsDirPath: tmp, retentionDays: 365 });
    await w.flush();
    expect((await fs.readdir(tmp)).length).toBe(0);
  });

  it("enqueue не пишет если выключено", async () => {
    const tmp = await mkTempDir();
    const app = { vault: {}, workspace: {} } as any;
    const w = new LogFileWriter({ app, logsDirPath: tmp, enabled: false });
    w.enqueue({ ts: Date.now(), level: "info", message: "a" });
    await w.flush();
    const entries = await fs.readdir(tmp);
    expect(entries.length).toBe(0);
  });

  it("setEnabled переключает запись в файлы", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-03T10:00:00.000Z"));

    const tmp = await mkTempDir();
    const app = { vault: {}, workspace: {} } as any;
    const w = new LogFileWriter({ app, logsDirPath: tmp, enabled: true, retentionDays: 365 });

    w.setEnabled(false);
    w.enqueue({ ts: Date.now(), level: "info", message: "nope" });
    await w.flush();
    expect((await fs.readdir(tmp)).length).toBe(0);

    w.setEnabled(true);
    w.enqueue({ ts: Date.now(), level: "info", message: "ok" });
    await w.flush();
    const expected = path.join(tmp, "2026-01-03.log");
    const content = await fs.readFile(expected, "utf-8");
    expect(content).toContain("INFO ok");

    vi.useRealTimers();
  });

  it("setLogsDirPath меняет папку назначения", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-03T10:00:00.000Z"));

    const tmp1 = await mkTempDir();
    const tmp2 = await mkTempDir();
    const app = { vault: {}, workspace: {} } as any;
    const w = new LogFileWriter({ app, logsDirPath: tmp1, enabled: true, retentionDays: 365 });

    w.enqueue({ ts: Date.now(), level: "info", message: "a" });
    await w.flush();
    expect(await fs.readFile(path.join(tmp1, "2026-01-03.log"), "utf-8")).toContain("INFO a");

    w.setLogsDirPath(tmp2);
    w.enqueue({ ts: Date.now(), level: "info", message: "b" });
    await w.flush();
    expect(await fs.readFile(path.join(tmp2, "2026-01-03.log"), "utf-8")).toContain("INFO b");

    vi.useRealTimers();
  });

  it("ensureFileExists: при повторной записи в тот же файл проходит через fs.access (файл уже существует)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-03T10:00:00.000Z"));

    const tmp = await mkTempDir();
    const app = { vault: {}, workspace: {} } as any;
    const w = new LogFileWriter({ app, logsDirPath: tmp, enabled: true, retentionDays: 365 });

    w.enqueue({ ts: Date.now(), level: "info", message: "first" });
    await w.flush();

    w.enqueue({ ts: Date.now(), level: "info", message: "second" });
    await w.flush();

    const content = await fs.readFile(path.join(tmp, "2026-01-03.log"), "utf-8");
    expect(content).toContain("INFO first");
    expect(content).toContain("INFO second");

    vi.useRealTimers();
  });

  it("normalizeRetentionDays: NaN -> 7 (через setRetentionDays)", async () => {
    const tmp = await mkTempDir();
    const app = { vault: {}, workspace: {} } as any;
    const w = new LogFileWriter({ app, logsDirPath: tmp, enabled: true, retentionDays: 365 });
    await w.setRetentionDays(Number.NaN);
  });

  it("formatEntry: message может быть nullish (через any) -> пишем пустую строку", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-03T10:00:00.000Z"));

    const tmp = await mkTempDir();
    const app = { vault: {}, workspace: {} } as any;
    const w = new LogFileWriter({ app, logsDirPath: tmp, enabled: true, retentionDays: 365 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    w.enqueue({ ts: Date.now(), level: "info", message: undefined as any });
    await w.flush();
    const content = await fs.readFile(path.join(tmp, "2026-01-03.log"), "utf-8");
    expect(content).toContain("INFO ");

    vi.useRealTimers();
  });

  it("ранние return: enqueue/openTodayLog/clearTodayLogFile/cleanupOldLogFiles при пустом logsDirPath", async () => {
    const app = { vault: {}, workspace: {} } as any;
    const w = new LogFileWriter({ app, logsDirPath: "", enabled: true, retentionDays: 7 });
    w.enqueue({ ts: Date.now(), level: "info", message: "x" }); // не должен добавиться
    await w.flush(); // не должен писать
    await w.openTodayLog(); // не должен падать
    await w.clearTodayLogFile(); // не должен падать
    await w.cleanupOldLogFiles(Date.now()); // не должен падать
  });

  it("cleanupOldLogFiles: ранний return при keepDays<=0 / NaN (через any)", async () => {
    const tmp = await mkTempDir();
    const app = { vault: {}, workspace: {} } as any;
    const w = new LogFileWriter({ app, logsDirPath: tmp, enabled: true, retentionDays: 7 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (w as any).retentionDays = 0;
    await w.cleanupOldLogFiles(Date.now());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (w as any).retentionDays = Number.NaN;
    await w.cleanupOldLogFiles(Date.now());
  });

  it("setConfig (deprecated) переключает enabled", async () => {
    const tmp = await mkTempDir();
    const app = { vault: {}, workspace: {} } as any;
    const w = new LogFileWriter({ app, logsDirPath: tmp, enabled: true, retentionDays: 365 });
    w.setConfig("ignored", false);
    w.enqueue({ ts: Date.now(), level: "info", message: "a" });
    await w.flush();
    const entries = await fs.readdir(tmp);
    expect(entries.length).toBe(0);
  });

  it("setRetentionDays нормализует значение и вызывает cleanupOldLogFiles()", async () => {
    const tmp = await mkTempDir();
    const app = { vault: {}, workspace: {} } as any;
    const w = new LogFileWriter({ app, logsDirPath: tmp, enabled: true, retentionDays: 365 });

    const spy = vi.spyOn(w, "cleanupOldLogFiles").mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await w.setRetentionDays("0" as any);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("openTodayLog создаёт файл за сегодня и открывает его", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-03T10:00:00.000Z"));

    const tmp = await mkTempDir();
    const app = { vault: {}, workspace: {} } as any;
    const opened: string[] = [];
    const w = new LogFileWriter({ app, logsDirPath: tmp, openExternal: (p) => opened.push(p) });

    await w.openTodayLog();

    const expected = path.join(tmp, "2026-01-03.log");
    await fs.readFile(expected, "utf-8");
    expect(opened).toEqual([expected]);

    vi.useRealTimers();
  });

  it("openTodayLog без openExternal не падает (fallback на electron игнорируется)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-03T10:00:00.000Z"));

    const tmp = await mkTempDir();
    const app = { vault: {}, workspace: {} } as any;
    const w = new LogFileWriter({ app, logsDirPath: tmp });

    await w.openTodayLog();

    const expected = path.join(tmp, "2026-01-03.log");
    await fs.readFile(expected, "utf-8");

    vi.useRealTimers();
  });

  it("openTodayLog без openExternal использует electron.shell.openPath, если доступно", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-03T10:00:00.000Z"));

    const tmp = await mkTempDir();
    const app = { vault: {}, workspace: {} } as any;
    const w = new LogFileWriter({ app, logsDirPath: tmp });

    // В vitest окружении пакета `electron` нет, а LogFileWriter использует CommonJS `require("electron")`.
    // Перехватываем загрузку модулей на уровне Node, чтобы покрыть ветку electron.shell.openPath.
    const openPath = vi.fn(async () => "");
    const modAny = Module as any;
    const prevLoad = modAny._load;
    modAny._load = function (request: string, parent: unknown, isMain: boolean) {
      if (request === "electron") return { shell: { openPath } };
      return prevLoad.call(this, request, parent, isMain);
    };

    try {
      await w.openTodayLog();
    } finally {
      modAny._load = prevLoad;
    }

    const expected = path.join(tmp, "2026-01-03.log");
    expect(openPath).toHaveBeenCalledTimes(1);
    expect(openPath).toHaveBeenCalledWith(expected);

    vi.useRealTimers();
  });

  it("clearTodayLogFile очищает файл за сегодня", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-04T10:00:00.000Z"));

    const tmp = await mkTempDir();
    const app = { vault: {}, workspace: {} } as any;
    const w = new LogFileWriter({ app, logsDirPath: tmp });
    w.enqueue({ ts: Date.now(), level: "info", message: "a" });
    await w.flush();

    const f = path.join(tmp, "2026-01-04.log");
    const before = await fs.readFile(f, "utf-8");
    expect(before.length).toBeGreaterThan(0);

    await w.clearTodayLogFile();
    const after = await fs.readFile(f, "utf-8");
    expect(after).toBe("");

    vi.useRealTimers();
  });

  it("cleanupOldLogFiles игнорирует ошибки чтения папки", async () => {
    const tmp = await mkTempDir();
    const blocker = path.join(tmp, "not-a-dir");
    await fs.writeFile(blocker, "x", "utf-8"); // файл, не директория

    const app = { vault: {}, workspace: {} } as any;
    const w = new LogFileWriter({ app, logsDirPath: blocker, retentionDays: 7 });
    await w.cleanupOldLogFiles(Date.UTC(2026, 0, 8, 12, 0, 0));
  });

  it("flush пишет data через String(data), если JSON.stringify падает (циклическая структура)", async () => {
    const tmp = await mkTempDir();
    const app = { vault: {}, workspace: {} } as any;
    const w = new LogFileWriter({ app, logsDirPath: tmp, retentionDays: 365 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {};
    data.self = data;
    w.enqueue({ ts: new Date("2026-01-01T10:00:00.000Z").getTime(), level: "info", message: "циклы", data });
    await w.flush();

    const f1 = await fs.readFile(path.join(tmp, "2026-01-01.log"), "utf-8");
    expect(f1).toContain("INFO циклы [object Object]");
  });

  it("enqueue ставит таймер и вызывает flush батчем", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));

    const tmp = await mkTempDir();
    const app = { vault: {}, workspace: {} } as any;
    const w = new LogFileWriter({ app, logsDirPath: tmp, retentionDays: 365 });

    const flushSpy = vi.spyOn(w, "flush").mockResolvedValue(undefined);
    w.enqueue({ ts: Date.now(), level: "info", message: "a" });
    vi.advanceTimersByTime(500);

    // Дать микротаскам выполниться (callback вызывает async flush()).
    await Promise.resolve();
    await Promise.resolve();

    expect(flushSpy).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("cleanupOldLogFiles удаляет файлы старше retentionDays", async () => {
    const tmp = await mkTempDir();
    const app = { vault: {}, workspace: {} } as any;
    const w = new LogFileWriter({ app, logsDirPath: tmp, retentionDays: 7 });

    // Сегодня: 2026-01-08 → удалить 2026-01-01 (ровно 7 дней), оставить 2026-01-02 и новее.
    await fs.writeFile(path.join(tmp, "2026-01-01.log"), "old", "utf-8");
    await fs.writeFile(path.join(tmp, "2026-01-02.log"), "keep", "utf-8");
    await fs.writeFile(path.join(tmp, "2026-01-03.log"), "keep", "utf-8");
    await fs.writeFile(path.join(tmp, "random.txt"), "x", "utf-8");

    const now = Date.UTC(2026, 0, 8, 12, 0, 0); // 2026-01-08T12:00:00Z
    await w.cleanupOldLogFiles(now);

    const files = new Set(await fs.readdir(tmp));
    expect(files.has("2026-01-01.log")).toBe(false);
    expect(files.has("2026-01-02.log")).toBe(true);
    expect(files.has("2026-01-03.log")).toBe(true);
    expect(files.has("random.txt")).toBe(true);
  });
});
