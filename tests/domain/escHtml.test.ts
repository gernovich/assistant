import { describe, expect, it } from "vitest";
import { escHtml } from "../../src/domain/policies/escHtml";

describe("domain/policies/escHtml", () => {
  it("экранирует спецсимволы", () => {
    expect(escHtml(`<a&"b">`)).toBe("&lt;a&amp;&quot;b&quot;&gt;");
  });
});
