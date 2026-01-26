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

  it("гарантирует минимум 10 записей и setMaxEntries делает trim и emit", () => {
    const log = new LogService(1);
    for (let i = 0; i < 50; i++) log.info(String(i));
    // min 10
    expect(log.list()).toHaveLength(10);
    expect(log.list()[0].message).toBe("40");

    const cb = vi.fn();
    log.onChange(cb);
    // setMaxEntries тоже держит минимум 10: проверяем, что происходит trim и emit
    log.setMaxEntries(5);
    expect(cb).toHaveBeenCalledTimes(1);
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

  it("редактирует секреты в message и data (и onEntry получает уже redacted)", () => {
    const onEntry = vi.fn();
    const log = new LogService(200, onEntry);

    log.error("Fetch failed: url=https://ex.com/x?access_token=abc&x=1 Authorization: Bearer SECRET", {
      url: "https://ex.com/x?refresh_token=RT&y=1#frag",
      Authorization: "Bearer TOPSECRET",
      nested: { client_secret: "CS", password: "p@ss", text: "token=ZZZ" },
    });

    const e = log.list()[0];
    expect(e.message).not.toContain("abc");
    expect(e.message).not.toContain("SECRET");
    expect(JSON.stringify(e.data)).not.toContain("RT");
    expect(JSON.stringify(e.data)).not.toContain("TOPSECRET");
    expect(JSON.stringify(e.data)).not.toContain("CS");
    expect(JSON.stringify(e.data)).not.toContain("p@ss");
    expect(JSON.stringify(e.data)).not.toContain("ZZZ");

    // onEntry тоже должен получать уже redacted данные
    const called = onEntry.mock.calls[0][0];
    expect(JSON.stringify(called)).not.toContain("abc");
    expect(JSON.stringify(called)).not.toContain("TOPSECRET");
  });

  it("scoped: добавляет префикс и объединяет fixed + data", () => {
    const log = new LogService(200);
    const scoped = log.scoped("Календарь", { opId: "1", fixed: true });
    scoped.info("старт", { fixed: false, extra: 1 });

    const e = log.list()[0];
    expect(e.message).toBe("Календарь: старт");
    expect(e.data).toEqual({ opId: "1", fixed: false, extra: 1 });
  });

  it("scoped: без fixed/data оставляет data undefined", () => {
    const log = new LogService(200);
    const scoped = log.scoped("Модуль");
    scoped.info("ok");
    const e = log.list()[0];
    expect(e.message).toBe("Модуль: ok");
    expect(e.data).toBeUndefined();
  });

  it("scoped: пустой scope не добавляет префикс", () => {
    const log = new LogService(200);
    const scoped = log.scoped("");
    scoped.info("ok");
    const e = log.list()[0];
    expect(e.message).toBe("ok");
  });

  it("scoped: fixed без data и data без fixed работают корректно", () => {
    const log = new LogService(200);
    const scopedFixed = log.scoped("A", { fixed: 1 });
    scopedFixed.info("m1");
    const scopedData = log.scoped("B");
    scopedData.info("m2", { extra: 2 });

    const [e1, e2] = log.list();
    expect(e1.data).toEqual({ fixed: 1 });
    expect(e2.data).toEqual({ extra: 2 });
  });

  it("санитизирует Error и вложенный cause", () => {
    const log = new LogService(200);
    const err = new Error("boom token=SECRET");
    (err as any).cause = { nested: "refresh_token=RT" };
    log.error("err", { err });

    const e = log.list()[0];
    const data = e.data as any;
    expect(data.err.name).toBe("Error");
    expect(String(data.err.message)).not.toContain("SECRET");
    expect(JSON.stringify(data.err.cause)).not.toContain("RT");
  });

  it("санитизирует Error без stack/cause и с пустыми полями", () => {
    const log = new LogService(200);
    const err = new Error();
    (err as any).name = undefined;
    (err as any).message = undefined;
    delete (err as any).stack;
    (err as any).cause = null;
    log.error("err", { err });

    const e = log.list()[0];
    const data = e.data as any;
    expect(data.err.name).toBe("Ошибка");
    expect(data.err.message).toBe("");
    expect(data.err.stack).toBeUndefined();
    expect(data.err.cause).toBeUndefined();
  });

  it("обрезает массивы/объекты и скрывает чувствительные ключи", () => {
    const log = new LogService(200);
    const bigArr = Array.from({ length: 205 }, (_, i) => `v${i}`);
    const bigObj: Record<string, unknown> = {};
    for (let i = 0; i < 205; i++) bigObj[`k${i}`] = `v${i}`;
    bigObj.password = "SECRET";
    bigObj.Authorization = "Bearer TOPSECRET";
    bigObj.someUrl = "https://ex.com/x?access_token=abc&x=1";

    log.info("x", { bigArr, bigObj });

    const e = log.list()[0];
    const data = e.data as any;
    expect(Array.isArray(data.bigArr)).toBe(true);
    expect(data.bigArr.length).toBe(201);
    expect(data.bigArr[data.bigArr.length - 1]).toBe("[обрезано]");
    expect(data.bigObj["[обрезано]"]).toBe("8 ключей");
    if (typeof data.bigObj.password === "string") expect(data.bigObj.password).toBe("***");
    if (typeof data.bigObj.Authorization === "string") expect(data.bigObj.Authorization).toBe("Bearer ***");
    if (typeof data.bigObj.someUrl === "string") expect(String(data.bigObj.someUrl)).not.toContain("abc");
    expect(JSON.stringify(data.bigObj)).not.toContain("SECRET");
  });

  it("обрезает слишком длинные строки", () => {
    const log = new LogService(200);
    const long = "x".repeat(5000);
    log.info(long);
    const e = log.list()[0];
    expect(e.message.length).toBeLessThanOrEqual(4013);
    expect(e.message).toContain("[обрезано]");
  });

  it("редактирует URL в message и чувствительные ключи", () => {
    const log = new LogService(200);
    log.info("https://ex.com/x?access_token=abc&x=1");
    log.info("x", { authorization: "Basic SECRET", token: "T", ok: "v", token_num: 1 });

    const items = log.list();
    expect(items[0].message).not.toContain("abc");
    const data = items[1].data as any;
    expect(data.authorization).toBe("Basic ***");
    expect(data.token).toBe("***");
    expect(data.ok).toBe("v");
    expect(data.token_num).toBe(1);
  });

  it("редактирует чувствительные ключи в разных регистрах", () => {
    const log = new LogService(200);
    log.info("x", { Authorization: "Bearer SECRET", password: "p" });
    const e = log.list()[0];
    const data = e.data as any;
    expect(data.Authorization).toBe("Bearer ***");
    expect(data.password).toBe("***");
  });

  it("sanitizeString принимает null/undefined", () => {
    const log = new LogService(200);
    log.info(undefined as unknown as string);
    log.info(null as unknown as string);
    const items = log.list();
    expect(items[0].message).toBe("");
    expect(items[1].message).toBe("");
  });

  it("редактирует глубоко вложенные структуры и нестандартные типы", () => {
    const log = new LogService(200);
    let deep: any = { level: 0 };
    for (let i = 0; i < 10; i++) deep = { inner: deep };

    log.info("x", {
      deep,
      Authorization: "Token 123",
      fn: () => 1,
      sym: Symbol("s"),
      nullable: null,
    });

    const e = log.list()[0];
    const data = e.data as any;
    expect(JSON.stringify(data.deep)).toContain("[обрезано]");
    expect(data.Authorization).toBe("***");
    expect(String(data.fn)).toContain("=>");
    expect(String(data.sym)).toContain("Symbol");
    expect(data.nullable).toBeNull();
  });
});
