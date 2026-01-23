import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/settingsStore";
import { LogService } from "../../src/log/logService";
import { AuthorizeGoogleCaldavUseCase } from "../../src/application/caldav/authorizeGoogleCaldavUseCase";

describe("AuthorizeGoogleCaldavUseCase", () => {
  it("сохраняет refreshToken и включает google_oauth", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.caldav.accounts = [
      {
        id: "acc1",
        name: "Google",
        enabled: true,
        serverUrl: "",
        username: "me@example.com",
        password: "",
        authMethod: "google_oauth",
        oauth: { clientId: "CID", clientSecret: "CS", refreshToken: "" },
      },
    ];

    const save = vi.fn(async () => {});
    const notice = vi.fn();
    const log = new LogService(200);

    const uc = new AuthorizeGoogleCaldavUseCase({
      getSettings: () => settings,
      saveSettingsAndApply: save,
      runOAuthFlow: async () => ({ refreshToken: "RT" }),
      openExternal: () => {},
      notice,
      log,
    });

    await uc.execute("acc1");

    const acc = settings.caldav.accounts[0];
    expect(acc.authMethod).toBe("google_oauth");
    expect(acc.serverUrl).toBe("https://apidata.googleusercontent.com/caldav/v2/");
    expect(acc.oauth?.refreshToken).toBe("RT");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("не запускает OAuth если нет clientId/clientSecret", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.caldav.accounts = [
      {
        id: "acc1",
        name: "Google",
        enabled: true,
        serverUrl: "",
        username: "me@example.com",
        password: "",
        authMethod: "google_oauth",
        oauth: { clientId: "", clientSecret: "", refreshToken: "" },
      },
    ];

    const save = vi.fn(async () => {});
    const notice = vi.fn();
    const run = vi.fn(async () => ({ refreshToken: "RT" }));
    const log = new LogService(200);

    const uc = new AuthorizeGoogleCaldavUseCase({
      getSettings: () => settings,
      saveSettingsAndApply: save,
      runOAuthFlow: run,
      openExternal: () => {},
      notice,
      log,
    });

    await uc.execute("acc1");

    expect(run).toHaveBeenCalledTimes(0);
    expect(save).toHaveBeenCalledTimes(0);
    expect(notice).toHaveBeenCalled();
  });

  it("executeResult: возвращает E_VALIDATION вместо throw для несуществующего аккаунта", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const save = vi.fn(async () => {});
    const notice = vi.fn();
    const log = new LogService(200);

    const uc = new AuthorizeGoogleCaldavUseCase({
      getSettings: () => settings,
      saveSettingsAndApply: save,
      runOAuthFlow: async () => ({ refreshToken: "RT" }),
      openExternal: () => {},
      notice,
      log,
    });

    const r = await uc.executeResult("missing");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("E_VALIDATION");
    expect(save).toHaveBeenCalledTimes(0);
    expect(notice).toHaveBeenCalledTimes(0); // Result-метод не показывает UI сам
  });
});

