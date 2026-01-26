const SENSITIVE_KEYS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "token",
  "code",
  "client_secret",
  "clientsecret",
  "password",
  "pass",
  "apikey",
  "api_key",
  "key",
]);

/**
 * Замаскировать чувствительные данные в URL (query/fragment).
 *
 * Пример: `...?access_token=abc&x=1` → `...?access_token=***&x=1`
 */
export function redactUrlForLog(url: string): string {
  const raw = String(url ?? "");
  if (!raw) return raw;

  try {
    // `URL()` требует абсолютный URL; для относительных просто вывалимся в резерв.
    const u = new URL(raw);
    // Важно: не итерируем `searchParams` “вживую” во время `set()`, чтобы не терять элементы.
    for (const k of Array.from(u.searchParams.keys())) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) u.searchParams.set(k, "***");
    }
    if (u.hash) {
      // Фрагмент иногда содержит токены (особенно при неявном потоке). Маскируем грубо.
      u.hash = "#***";
    }
    return u.toString();
  } catch {
    // Резерв для относительных/нестандартных строк: точечно маскируем параметры вида key=value.
    return raw
      .replace(
        /([?#&](?:access_token|refresh_token|id_token|token|code|client_secret|password|pass|api[_-]?key|key)=)([^&#\s]+)/gi,
        "$1***",
      )
      .replace(/(#)([^\s]+)/g, "$1***");
  }
}

/**
 * Замаскировать чувствительные значения в произвольной строке (для логов).
 *
 * Поддерживает:
 * - `... token=...`
 * - `Authorization: Bearer ...`
 * - `Authorization: Basic ...`
 */
export function redactSecretsInStringForLog(input: string): string {
  const s = String(input ?? "");
  if (!s) return s;

  let out = s;
  // key=value в query-формате (?...&...).
  out = out.replace(
    /([?#&](?:access_token|refresh_token|id_token|token|code|client_secret|password|pass|api[_-]?key|key)=)([^&#\s]+)/gi,
    "$1***",
  );
  // key=value в “обычном” тексте (например в сообщениях ошибок).
  out = out.replace(
    /\b(access_token|refresh_token|id_token|token|code|client_secret|password|pass|api[_-]?key|key)\b\s*=\s*([^\s,;&#]+)/gi,
    "$1=***",
  );
  out = out.replace(/(\bAuthorization:\s*Bearer\s+)([^\s]+)/gi, "$1***");
  out = out.replace(/(\bAuthorization:\s*Basic\s+)([^\s]+)/gi, "$1***");
  out = out.replace(/(\bclient_secret\b\s*[:=]\s*)([^\s,;&#]+)/gi, "$1***");
  out = out.replace(/(\brefresh_token\b\s*[:=]\s*)([^\s,;&#]+)/gi, "$1***");
  out = out.replace(/(\baccess_token\b\s*[:=]\s*)([^\s,;&#]+)/gi, "$1***");
  out = out.replace(/(\bpassword\b\s*[:=]\s*)([^\s,;&#]+)/gi, "$1***");

  // Фрагмент иногда содержит токены (неявный поток). Маскируем грубо.
  // Фрагмент иногда содержит токены (неявный поток). Маскируем грубо.
  out = out.replace(/(#)([^\s]+)/g, "$1***");
  return out;
}
