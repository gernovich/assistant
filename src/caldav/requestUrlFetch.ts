import { requestUrl } from "obsidian";

/** Тип входа для fetch-совместимого API (RequestInfo/URL). */
export type FetchInput = RequestInfo | URL;

/** Привести `FetchInput` к строковому URL. */
export function toUrl(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** Преобразовать `HeadersInit` в простой объект, совместимый с `requestUrl`. */
export function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((v, k) => (out[k] = v));
    return out;
  }
  if (Array.isArray(headers)) {
    const out: Record<string, string> = {};
    for (const [k, v] of headers) out[k] = v;
    return out;
  }
  return { ...(headers as Record<string, string>) };
}

/** Преобразовать `fetch`-body в формат, который понимает Obsidian `requestUrl`. */
export function bodyToRequestUrlBody(body: BodyInit | null | undefined): string | ArrayBuffer | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return body;
  // ArrayBufferView / Uint8Array etc.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyBody = body as any;
  if (anyBody?.buffer instanceof ArrayBuffer) return anyBody.buffer as ArrayBuffer;
  return String(body);
}

/**
 * `fetch` поверх Obsidian `requestUrl` (без CORS) для использования в tsdav/CalDAV.
 *
 * Важно: `requestUrl` возвращает `arrayBuffer` и `headers`, которые мы переносим в стандартный `Response`.
 */
export async function requestUrlFetch(input: FetchInput, init?: RequestInit): Promise<Response> {
  const url = toUrl(input);
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = headersToRecord(init?.headers);
  const body = bodyToRequestUrlBody(init?.body);

  const res = await requestUrl({
    url,
    method,
    headers,
    body,
    throw: false,
  });

  return new Response(res.arrayBuffer, {
    status: res.status,
    headers: res.headers,
  });
}
