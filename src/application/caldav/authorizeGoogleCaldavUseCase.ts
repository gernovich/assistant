import type { AssistantSettings } from "../../types";
import type { LogService } from "../../log/logService";
import { err, ok, type Result } from "../../shared/result";

export type RunGoogleOAuthFlow = (params: {
  clientId: string;
  clientSecret: string;
  scope: string;
  openExternal: (url: string) => void;
}) => Promise<{ refreshToken: string }>;

/**
 * Use-case: Google OAuth (loopback) для CalDAV аккаунта.
 *
 * Важно: use-case не зависит от Obsidian/Electron напрямую. Инфраструктурные детали (открытие браузера,
 * loopback server, etc) передаются портом `runOAuthFlow`.
 */
export class AuthorizeGoogleCaldavUseCase {
  constructor(
    private readonly deps: {
      getSettings: () => AssistantSettings;
      saveSettingsAndApply: () => Promise<void>;
      runOAuthFlow: RunGoogleOAuthFlow;
      openExternal: (url: string) => void;
      notice: (msg: string) => void;
      log: LogService;
    },
  ) {}

  async executeResult(accountId: string): Promise<Result<{ accountName: string }>> {
    const s = this.deps.getSettings();
    const acc = s.caldav.accounts.find((a) => a.id === accountId);
    if (!acc) {
      return err({
        code: "E_VALIDATION",
        message: "Ассистент: CalDAV аккаунт не найден",
        details: { accountId },
      });
    }

    const oauth = acc.oauth ?? { clientId: "", clientSecret: "", refreshToken: "" };
    if (!oauth.clientId || !oauth.clientSecret) {
      return err({
        code: "E_VALIDATION",
        message: "Ассистент: заполните clientId/clientSecret для Google OAuth",
        details: { accountId },
      });
    }
    if (!acc.username.trim()) {
      return err({
        code: "E_VALIDATION",
        message: "Ассистент: заполните Login (email) для CalDAV аккаунта",
        details: { accountId },
      });
    }

    const scope = "https://www.googleapis.com/auth/calendar";

    let refreshToken = "";
    try {
      ({ refreshToken } = await this.deps.runOAuthFlow({
        clientId: oauth.clientId,
        clientSecret: oauth.clientSecret,
        scope,
        openExternal: this.deps.openExternal,
      }));
    } catch (e) {
      const raw = String((e as unknown) ?? "неизвестная ошибка");
      const short = raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
      return err({
        code: "E_CALDAV_AUTH",
        message: `Ассистент: Google OAuth ошибка: ${short}. Подробности в логе.`,
        cause: raw,
        details: { accountId, accountName: acc.name },
      });
    }

    // Проставляем authMethod + фиксируем Google CalDAV v2 root (без email).
    acc.authMethod = "google_oauth";
    acc.serverUrl = "https://apidata.googleusercontent.com/caldav/v2/";
    acc.oauth = { ...oauth, refreshToken };

    await this.deps.saveSettingsAndApply();
    return ok({ accountName: acc.name });
  }

  async execute(accountId: string): Promise<void> {
    const r = await this.executeResult(accountId);
    if (!r.ok) {
      if (r.error.code === "E_CALDAV_AUTH") {
        this.deps.log.error("CalDAV: Google OAuth: ошибка", { code: r.error.code, error: r.error.cause, details: r.error.details });
      } else {
        this.deps.log.warn("CalDAV: Google OAuth: ошибка валидации", { code: r.error.code, details: r.error.details });
      }
      this.deps.notice(r.error.message);
      return;
    }
    this.deps.log.info("CalDAV: Google OAuth: успех (refresh_token сохранён)", { account: r.value.accountName });
    this.deps.notice("Ассистент: Google OAuth успешно");
  }
}
