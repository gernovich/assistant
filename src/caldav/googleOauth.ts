import { requestUrl } from "obsidian";

type CodeResult = { code: string; state: string };

/** Случайный `state` для защиты OAuth callback от подделки запроса. */
function randomState(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyCrypto = crypto as any;
  if (anyCrypto?.randomUUID) return anyCrypto.randomUUID();
  return `st_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Собрать URL авторизации Google OAuth2 для loopback потока.
 * Важно: используем `access_type=offline` и `prompt=consent`, чтобы получить `refresh_token`.
 */
export function buildGoogleAuthUrl(params: { clientId: string; redirectUri: string; scope: string; state: string }): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", params.scope);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", params.state);
  return url.toString();
}

/**
 * Запустить loopback OAuth: поднимаем локальный HTTP сервер на 127.0.0.1,
 * открываем браузер на страницу авторизации, принимаем callback и обмениваем code на tokens.
 */
export async function runGoogleLoopbackOAuth(params: {
  clientId: string;
  clientSecret: string;
  scope: string;
  openExternal: (url: string) => void;
  timeoutMs?: number;
}): Promise<{ refreshToken: string }> {
  const state = randomState();
  const { server, redirectUri, waitForResult } = await startLoopbackServer({
    state,
    onCode: async ({ code, redirectUri }) => {
      const tokens = await exchangeGoogleCodeForTokens({
        code,
        clientId: params.clientId,
        clientSecret: params.clientSecret,
        redirectUri,
      });
      const refreshToken = String(tokens.refresh_token ?? "");
      if (!refreshToken) {
        return await Promise.reject(
          "Google OAuth: refresh_token не получен. " +
            "Обычно помогает: удалить доступ приложения в Google Account → Security → Third-party access, и авторизоваться заново.",
        );
      }
      return { refreshToken };
    },
  });
  const authUrl = buildGoogleAuthUrl({
    clientId: params.clientId,
    redirectUri,
    scope: params.scope,
    state,
  });

  params.openExternal(authUrl);

  try {
    return await withTimeout(waitForResult(), params.timeoutMs ?? 120_000);
  } finally {
    // Даём браузеру шанс сходить на /finish|/error после 302 с callback, иначе можно словить “сайт недоступен”
    // на медленных/загруженных системах (обмен кода на токены может закрыть сервер слишком быстро).
    window.setTimeout(() => server.close(), 1500);
  }
}

async function exchangeGoogleCodeForTokens(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  }).toString();

  const res = await requestUrl({
    url: "https://oauth2.googleapis.com/token",
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    throw: false,
  });

  if (res.status < 200 || res.status >= 300) {
    const raw = res.text ?? "";
    const reason = raw.slice(0, 400);
    try {
      const json = JSON.parse(raw) as { error?: string; error_description?: string };
      if (res.status === 401 && json?.error === "invalid_client") {
        const desc = json?.error_description ? ` (${json.error_description})` : "";
        return await Promise.reject(
          "Google OAuth: обмен кода на токены не удался: invalid_client" +
            desc +
            ". Проверьте clientId/clientSecret. " +
            "Для loopback (127.0.0.1 с динамическим портом) рекомендуем OAuth Client ID типа «Desktop app».",
        );
      }
    } catch {
      // ignore JSON parse errors
    }
    return await Promise.reject(`Google OAuth: обмен кода на токены не удался: HTTP ${res.status}: ${reason}`);
  }

  try {
    // requestUrl иногда уже парсит json, но нам важно единообразие/детерминизм.
    return JSON.parse(res.text ?? "{}") as Record<string, unknown>;
  } catch (e) {
    return await Promise.reject(`Google OAuth: обмен кода на токены вернул некорректный JSON: ${(res.text ?? "").slice(0, 200)}`);
  }
}

async function startLoopbackServer(params: {
  state: string;
  onCode: (p: { code: string; redirectUri: string }) => Promise<{ refreshToken: string }>;
}): Promise<{
  server: import("http").Server;
  redirectUri: string;
  waitForResult: () => Promise<{ refreshToken: string }>;
}> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const http = require("http") as typeof import("http");

  let resolve!: (r: { refreshToken: string }) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<{ refreshToken: string }>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  let lastError: string | null = null;
  let redirectUri = "";

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      // Красивые страницы без параметров в адресе:
      // - /finish: успех
      // - /error: ошибка (последняя ошибка берётся из памяти сервера)
      if (url.pathname === "/finish") {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(renderOAuthResultPage({ kind: "success" }));
        return;
      }
      if (url.pathname === "/error") {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(renderOAuthResultPage({ kind: "error", details: lastError ?? "Неизвестная ошибка" }));
        return;
      }

      if (url.pathname !== "/assistant-oauth-callback") {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        res.end("Не найдено");
        return;
      }

      const code = url.searchParams.get("code") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const error = url.searchParams.get("error") ?? "";

      if (error) {
        lastError = error;
        res.writeHead(302, { location: "/error", "cache-control": "no-store" });
        res.end();
        reject(`Google OAuth: ошибка: ${error}`);
        return;
      }
      if (!code || !state || state !== params.state) {
        lastError = "Некорректный callback (state/code)";
        res.writeHead(302, { location: "/error", "cache-control": "no-store" });
        res.end();
        reject("Google OAuth: некорректный callback state/code");
        return;
      }

      // Важно: считаем успехом только получение refresh_token.
      // Иначе будет ложное “Авторизация завершена”, но Obsidian останется без токена.
      Promise.resolve()
        .then(async () => {
          const out = await params.onCode({ code, redirectUri });
          resolve(out);
          res.writeHead(302, { location: "/finish", "cache-control": "no-store" });
          res.end();
        })
        .catch((e) => {
          lastError = String((e as unknown) ?? "неизвестная ошибка");
          res.writeHead(302, { location: "/error", "cache-control": "no-store" });
          res.end();
          reject(e);
        });
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("Внутренняя ошибка");
      reject(e);
    }
  });

  await new Promise<void>((res, rej) => {
    server.listen(0, "127.0.0.1", () => res());
    server.on("error", (e) => rej(e));
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  redirectUri = `http://127.0.0.1:${port}/assistant-oauth-callback`;

  return {
    server,
    redirectUri,
    waitForResult: () => promise,
  };
}

function escapeHtml(s: string): string {
  // Не используем String.prototype.replaceAll, чтобы не повышать target/lib выше ES2018.
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderOAuthResultPage(params: { kind: "success" } | { kind: "error"; details: string }): string {
  const isOk = params.kind === "success";
  const bg = isOk ? "#eaf8ee" : "#fdecec";
  const border = isOk ? "#bde5c8" : "#f3b5b5";
  const title = isOk ? "Авторизация завершена" : "Ошибка авторизации";
  const subtitle = isOk
    ? "Можете закрыть окно браузера и вернуться в Obsidian."
    : "Вернитесь в Obsidian — там будет подробная ошибка. Если нужно, повторите авторизацию.";
  const details =
    params.kind === "error" ? `<div class="details"><div class="label">Детали:</div><pre>${escapeHtml(params.details)}</pre></div>` : "";

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light; }
      html, body { height: 100%; margin: 0; }
      body {
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial;
        background: ${bg};
        color: #0f172a;
        display: grid;
        place-items: center;
      }
      .card {
        width: min(720px, calc(100% - 32px));
        background: rgba(255,255,255,0.85);
        border: 1px solid ${border};
        border-radius: 16px;
        padding: 28px 26px;
        box-shadow: 0 10px 30px rgba(2, 6, 23, 0.08);
      }
      h1 { margin: 0 0 10px; font-size: 28px; line-height: 1.2; }
      p { margin: 0; font-size: 16px; line-height: 1.5; color: rgba(15, 23, 42, 0.85); }
      .details { margin-top: 18px; }
      .label { font-size: 13px; color: rgba(15, 23, 42, 0.65); margin-bottom: 6px; }
      pre {
        margin: 0;
        background: rgba(15, 23, 42, 0.06);
        padding: 12px;
        border-radius: 10px;
        overflow: auto;
        font-size: 13px;
        line-height: 1.4;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${title}</h1>
      <p>${subtitle}</p>
      ${details}
    </div>
  </body>
</html>`;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject("OAuth timeout"), ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}
