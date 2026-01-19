import { describe, expect, it, vi } from "vitest";
import { headersToRecord, bodyToRequestUrlBody, requestUrlFetch } from "../src/caldav/requestUrlFetch";
import * as obsidian from "obsidian";

describe("requestUrlFetch helpers", () => {
  it("headersToRecord поддерживает Headers и массив пар", () => {
    const h = new Headers();
    h.set("a", "1");
    expect(headersToRecord(h)).toEqual({ a: "1" });
    expect(
      headersToRecord([
        ["x", "y"],
        ["a", "b"],
      ]),
    ).toEqual({ x: "y", a: "b" });
  });

  it("headersToRecord поддерживает plain object и undefined", () => {
    expect(headersToRecord(undefined)).toEqual({});
    expect(headersToRecord({ a: "1", b: "2" })).toEqual({ a: "1", b: "2" });
  });

  it("bodyToRequestUrlBody поддерживает string, URLSearchParams, ArrayBuffer и Uint8Array", () => {
    expect(bodyToRequestUrlBody("x")).toBe("x");
    expect(bodyToRequestUrlBody(new URLSearchParams({ a: "1" }))).toBe("a=1");
    // В JSDOM иногда странно себя ведёт сравнение с TextEncoder().buffer — используем “чистый” ArrayBuffer.
    const ab = new ArrayBuffer(3);
    expect(bodyToRequestUrlBody(ab)).toBe(ab);
    const u8 = new Uint8Array(ab);
    u8.set([1, 2, 3]);
    expect(bodyToRequestUrlBody(u8)).toBe(ab);
  });

  it("bodyToRequestUrlBody возвращает undefined для null/undefined", () => {
    expect(bodyToRequestUrlBody(undefined)).toBeUndefined();
    expect(bodyToRequestUrlBody(null)).toBeUndefined();
  });
});

describe("requestUrlFetch", () => {
  it("делает запрос через obsidian.requestUrl и возвращает Response", async () => {
    const spy = vi.spyOn(obsidian, "requestUrl").mockResolvedValue({
      status: 200,
      headers: { "content-type": "text/plain" },
      text: "ok",
      arrayBuffer: new TextEncoder().encode("ok").buffer,
      // В Obsidian тип `RequestUrlResponse` содержит `json` (может быть любым) — добавляем для typecheck.
      json: null,
    });

    const res = await requestUrlFetch("https://example.com", { method: "POST", body: "x", headers: { a: "1" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(spy).toHaveBeenCalled();
  });
});
