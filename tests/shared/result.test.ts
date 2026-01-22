import { describe, expect, it } from "vitest";
import { err, isErr, isOk, ok, type AppErrorDto, type Result } from "../../src/shared/result";

describe("shared/result", () => {
  it("ok(): возвращает ok=true и value", () => {
    const r = ok(123);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.value).toBe(123);
  });

  it("err(): возвращает ok=false и error", () => {
    const e: AppErrorDto = { code: "E_INTERNAL", message: "boom" };
    const r = err<number>(e);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected err");
    expect(r.error.code).toBe("E_INTERNAL");
    expect(r.error.message).toBe("boom");
  });

  it("type guards isOk/isErr работают", () => {
    const a: Result<number> = ok(1);
    const b: Result<number> = err({ code: "E_TIMEOUT", message: "t" });

    expect(isOk(a)).toBe(true);
    expect(isErr(a)).toBe(false);
    expect(isOk(b)).toBe(false);
    expect(isErr(b)).toBe(true);
  });
});

