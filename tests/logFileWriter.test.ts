import { describe, expect, it, vi } from "vitest";
import { LogFileWriter } from "../src/log/logFileWriter";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

  it("enqueue не пишет если выключено", async () => {
    const tmp = await mkTempDir();
    const app = { vault: {}, workspace: {} } as any;
    const w = new LogFileWriter({ app, logsDirPath: tmp, enabled: false });
    w.enqueue({ ts: Date.now(), level: "info", message: "a" });
    await w.flush();
    const entries = await fs.readdir(tmp);
    expect(entries.length).toBe(0);
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
