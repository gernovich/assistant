import { requestUrl } from "obsidian";

let installed = false;
let originalFetch: typeof fetch | null = null;

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
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

function bodyToRequestUrlBody(body: BodyInit | null | undefined): string | ArrayBuffer | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  // URLSearchParams in browser
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return body;
  // ArrayBufferView / Uint8Array etc.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyBody = body as any;
  if (anyBody?.buffer instanceof ArrayBuffer) return anyBody.buffer as ArrayBuffer;
  return String(body);
}

/**
 * Patch global fetch to route http(s) requests through Obsidian `requestUrl`
 * (no CORS restrictions). This is important for CalDAV in Obsidian renderer.
 *
 * We keep a fallback to the original fetch for non-http(s) URLs.
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

    const method = (init?.method ?? "GET").toUpperCase();
    const headers = headersToRecord(init?.headers);
    const body = bodyToRequestUrlBody(init?.body);

    let res: Awaited<ReturnType<typeof requestUrl>>;
    try {
      res = await requestUrl({
        url,
        method,
        headers,
        body,
        throw: false,
      });
    } catch (e) {
      const msg = String((e as unknown) ?? "unknown");
      throw new Error(`Obsidian requestUrl failed: ${msg} (method=${method}, url=${url})`);
    }

    return new Response(res.arrayBuffer, {
      status: res.status,
      headers: res.headers,
    });
  };
}

