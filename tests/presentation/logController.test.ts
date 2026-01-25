import { describe, expect, it, vi } from "vitest";
import { LogService } from "../../src/log/logService";
import { DefaultLogController } from "../../src/presentation/controllers/logController";

describe("DefaultLogController", () => {
  it("clearAll: очищает in-memory лог и вызывает clearTodayFile", async () => {
    const log = new LogService(200);
    log.info("a");
    log.warn("b");

    const openTodayFile = vi.fn();
    const clearTodayFile = vi.fn(async () => {});
    const openAgenda = vi.fn();
    const openTestDialog = vi.fn();
    const sendTestMessage = vi.fn();

    const c = new DefaultLogController({ log, openTodayFile, clearTodayFile, openAgenda, openTestDialog, sendTestMessage });

    expect(c.list().length).toBe(2);
    await c.clearAll();

    expect(c.list()).toHaveLength(0);
    expect(clearTodayFile).toHaveBeenCalledTimes(1);
  });

  it("clearAll: не падает если clearTodayFile бросает ошибку", async () => {
    const log = new LogService(200);
    log.info("a");

    const c = new DefaultLogController({
      log,
      openTodayFile: () => {},
      clearTodayFile: async () => {
        throw new Error("boom");
      },
      openAgenda: () => {},
      openTestDialog: () => {},
      sendTestMessage: () => {},
    });

    await expect(c.clearAll()).resolves.toBeUndefined();
    expect(c.list()).toHaveLength(0);
  });
});
