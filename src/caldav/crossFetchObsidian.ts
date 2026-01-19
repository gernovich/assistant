import { requestUrl } from "obsidian";

type FetchInput = RequestInfo | URL;

function toUrl(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

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
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return body;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyBody = body as any;
  if (anyBody?.buffer instanceof ArrayBuffer) return anyBody.buffer as ArrayBuffer;
  return String(body);
}

/**
 * `cross-fetch` compatible fetch that routes requests through Obsidian `requestUrl`
 * (no CORS restrictions in Obsidian/Electron renderer).
 */
export async function fetch(input: FetchInput, init?: RequestInit): Promise<Response> {
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

export default fetch;

