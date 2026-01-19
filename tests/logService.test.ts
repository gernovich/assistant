import { describe, expect, it, vi } from "vitest";
import { LogService } from "../src/log/logService";

describe("LogService", () => {
  it("добавляет записи и вызывает onEntry", () => {
    const onEntry = vi.fn();
    const log = new LogService(200, onEntry);

    log.info("i", { a: 1 });
    log.warn("w");
    log.error("e");

    const items = log.list();
    expect(items).toHaveLength(3);
    expect(items.map((x) => x.level)).toEqual(["info", "warn", "error"]);
    expect(onEntry).toHaveBeenCalledTimes(3);
  });

  it("поддерживает лимит и trim старых записей", () => {
    const log = new LogService(10);
    for (let i = 0; i < 50; i++) log.info(String(i));
    expect(log.list()).toHaveLength(10);
    expect(log.list()[0].message).toBe("40");
  });

  it("onChange вызывается при добавлении и clear", () => {
    const log = new LogService(200);
    const cb = vi.fn();
    const unsub = log.onChange(cb);

    log.info("x");
    log.clear();
    expect(cb).toHaveBeenCalledTimes(2);

    unsub();
    log.info("y");
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
