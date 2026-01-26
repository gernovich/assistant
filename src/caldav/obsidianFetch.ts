import { requestUrlFetch } from "./requestUrlFetch";
import { redactUrlForLog } from "../log/redact";

let installed = false;
let originalFetch: typeof fetch | null = null;

/**
 * Патчит глобальный `fetch`, чтобы маршрутизировать http(s) запросы через Obsidian `requestUrl`
 * (без CORS-ограничений). Это критично для CalDAV внутри Obsidian/Electron.
 *
 * Для не-http(s) URL оставляем резерв на оригинальный fetch.
 */
export function ensureObsidianFetchInstalled(): void {
  if (installed) return;
  if (typeof fetch !== "function") return;

  originalFetch = fetch.bind(globalThis);
  installed = true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return await originalFetch!(input as any, init);
    }

    try {
      return await requestUrlFetch(input, init);
    } catch (e) {
      const msg = String((e as unknown) ?? "неизвестная ошибка");
      const method = (init?.method ?? "GET").toUpperCase();
      return await Promise.reject(`Obsidian requestUrl: ошибка запроса: ${msg} (method=${method}, url=${redactUrlForLog(url)})`);
    }
  };
}
