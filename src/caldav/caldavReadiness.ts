import type { CaldavAccountConfig } from "../types";

/**
 * Проверка “готовности” CalDAV аккаунта для login/discovery.
 *
 * Возвращает:
 * - ok=true если все необходимые поля заполнены
 * - список причин (reasons), если не готов
 */
export function getCaldavAccountReadiness(acc: CaldavAccountConfig): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!acc.enabled) reasons.push("Аккаунт выключен");

  const method = acc.authMethod ?? "basic";
  if (!acc.serverUrl.trim()) reasons.push("Не задан URL сервера");
  if (!acc.username.trim()) reasons.push("Не задан логин (email)");

  if (method === "basic") {
    if (!acc.password) reasons.push("Не задан пароль / пароль приложения");
  } else {
    const oauth = acc.oauth ?? { clientId: "", clientSecret: "", refreshToken: "" };
    if (!oauth.clientId.trim()) reasons.push("Не задан clientId (Google OAuth)");
    if (!oauth.clientSecret.trim()) reasons.push("Не задан clientSecret (Google OAuth)");
    if (!oauth.refreshToken.trim()) reasons.push("Нет refresh‑токена — нажмите «Авторизоваться»");
  }

  return { ok: reasons.length === 0, reasons };
}
