import { describe, expect, it } from "vitest";
import { redactSecretsInStringForLog, redactUrlForLog } from "../src/log/redact";

describe("redactUrlForLog", () => {
  it("не падает на пустой строке", () => {
    expect(redactUrlForLog("")).toBe("");
  });

  it("маскирует чувствительные query-параметры", () => {
    const u = "https://example.com/c.ics?token=abc123&x=1&access_token=zzz";
    expect(redactUrlForLog(u)).toContain("token=***");
    expect(redactUrlForLog(u)).toContain("access_token=***");
    expect(redactUrlForLog(u)).toContain("x=1");
  });

  it("маскирует fragment", () => {
    const u = "https://example.com/callback#access_token=abc";
    expect(redactUrlForLog(u)).toContain("#***");
  });

  it("fallback: маскирует относительный URL (без потери безопасных параметров)", () => {
    const u = "/x?refresh_token=abc&x=1#access_token=zzz";
    const out = redactUrlForLog(u);
    expect(out).toContain("refresh_token=***");
    expect(out).toContain("x=1");
    expect(out).toContain("#***");
  });
});

describe("redactSecretsInStringForLog", () => {
  it("не падает на пустой строке", () => {
    expect(redactSecretsInStringForLog("")).toBe("");
  });

  it("маскирует Authorization header", () => {
    const s = "Authorization: Bearer abc.def.ghi";
    expect(redactSecretsInStringForLog(s)).toBe("Authorization: Bearer ***");
  });

  it("маскирует token/code/password в строке", () => {
    const s = "error: token=abc code=123 password=qwerty";
    const out = redactSecretsInStringForLog(s);
    expect(out).toContain("token=***");
    expect(out).toContain("code=***");
    expect(out).toContain("password=***");
  });

  it("маскирует токены внутри URL в строке", () => {
    const s = "fetch failed url=https://example.com/?refresh_token=abc&x=1";
    const out = redactSecretsInStringForLog(s);
    expect(out).toContain("refresh_token=***");
    expect(out).toContain("x=1");
  });
});
