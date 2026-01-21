import { describe, expect, it } from "vitest";
import { getCaldavAccountReadiness } from "../src/caldav/caldavReadiness";
import type { CaldavAccountConfig } from "../src/types";

function acc(partial: Partial<CaldavAccountConfig>): CaldavAccountConfig {
  return {
    id: "a1",
    name: "CalDAV",
    enabled: true,
    serverUrl: "https://example.com/caldav",
    username: "me@example.com",
    password: "secret",
    authMethod: "basic",
    ...partial,
  };
}

describe("getCaldavAccountReadiness", () => {
  it("по умолчанию использует basic (authMethod не задан)", () => {
    const r = getCaldavAccountReadiness(
      acc({
        // authMethod отсутствует → должен считаться basic
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        authMethod: undefined as any,
        password: "",
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("Не задан пароль / пароль приложения");
  });

  it("basic: требует serverUrl/username/password и enabled", () => {
    const r = getCaldavAccountReadiness(
      acc({
        enabled: false,
        serverUrl: "",
        username: "",
        password: "",
        authMethod: "basic",
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("Аккаунт выключен");
    expect(r.reasons).toContain("Не задан URL сервера");
    expect(r.reasons).toContain("Не задан логин (email)");
    expect(r.reasons).toContain("Не задан пароль / пароль приложения");
  });

  it("google_oauth: требует clientId/clientSecret/refreshToken", () => {
    const r = getCaldavAccountReadiness(
      acc({
        authMethod: "google_oauth",
        password: "",
        oauth: { clientId: "", clientSecret: "", refreshToken: "" },
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("Не задан clientId (Google OAuth)");
    expect(r.reasons).toContain("Не задан clientSecret (Google OAuth)");
    expect(r.reasons).toContain("Нет refresh‑токена — нажмите «Авторизоваться»");
  });

  it("google_oauth: если oauth не задан, использует пустые значения и возвращает причины", () => {
    const r = getCaldavAccountReadiness(
      acc({
        authMethod: "google_oauth",
        password: "",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        oauth: undefined as any,
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("Не задан clientId (Google OAuth)");
    expect(r.reasons).toContain("Не задан clientSecret (Google OAuth)");
    expect(r.reasons).toContain("Нет refresh‑токена — нажмите «Авторизоваться»");
  });

  it("ok: возвращает ok=true когда всё заполнено", () => {
    const r = getCaldavAccountReadiness(
      acc({
        authMethod: "google_oauth",
        oauth: { clientId: "id", clientSecret: "secret", refreshToken: "rt" },
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.reasons).toHaveLength(0);
  });
});
