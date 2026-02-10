import { requestUrl } from "obsidian";

export type NexaraVerboseJsonSegment = {
  id?: number;
  start?: number; // seconds
  end?: number; // seconds
  text?: string;
  speaker?: string; // для диаризации: "speaker_0", "speaker_1", etc.
};

export type NexaraVerboseJsonResponse = {
  text?: string;
  language?: string;
  duration?: number;
  segments?: NexaraVerboseJsonSegment[];
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Logger = {
  info: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

export class NexaraClient {
  constructor(
    private readonly deps: {
      fetch: FetchLike;
      apiBaseUrl: string; // e.g. https://api.nexara.ru/api/v1
      token: string;
      log?: Logger;
    },
  ) {}

  async transcribeVerboseJson(params: {
    fileBlob: Blob;
    fileName: string;
    /** segment timestamps only (simplest) */
    timestamps: "segment";
  }): Promise<NexaraVerboseJsonResponse> {
    const base = String(this.deps.apiBaseUrl || "").trim().replace(/\/+$/g, "");
    const url = `${base}/audio/transcriptions`;

    const form = new FormData();
    form.append("file", params.fileBlob, params.fileName);
    form.append("response_format", "verbose_json");
    if (params.timestamps === "segment") {
      // API expects array form key: timestamp_granularities[]
      form.append("timestamp_granularities[]", "segment");
    }
    // Для получения сегментов используем task=transcribe (диаризация возвращает только text без сегментов)
    // Если нужна диаризация, можно добавить отдельный метод
    form.append("language", "ru");

    const token = String(this.deps.token || "");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    // В Obsidian fetch может быть обёрнут в requestUrlFetch, который не поддерживает FormData.
    // Поэтому всегда используем multipart/form-data через requestUrl напрямую.
    const r = await this.fetchWithMultipartFormData(url, form, headers);

    const text = await r.text().catch(() => "");
    
    this.deps.log?.info("Nexara API: ответ", { 
      status: r.status, 
      statusText: r.statusText,
      textLength: text.length,
      textPreview: text.slice(0, 500),
      fullText: text, // Логируем полный ответ для отладки
    });

    if (!r.ok) {
      const errorMsg = `Nexara HTTP ${r.status}: ${text || r.statusText}`;
      this.deps.log?.error("Nexara API: ошибка", { status: r.status, text });
      throw new Error(errorMsg);
    }

    try {
      const parsed = JSON.parse(text) as NexaraVerboseJsonResponse;
      this.deps.log?.info("Nexara API: успешный ответ", {
        hasText: !!parsed.text,
        textLength: parsed.text?.length ?? 0,
        segmentsCount: parsed.segments?.length ?? 0,
        language: parsed.language,
        duration: parsed.duration,
        parsedKeys: Object.keys(parsed), // Логируем все ключи ответа
      });
      
      // Если нет сегментов, но есть text, создаем один сегмент из всего текста
      if (!parsed.segments || parsed.segments.length === 0) {
        if (parsed.text) {
          this.deps.log?.info("Nexara API: сегменты отсутствуют, создаем из text", {
            textLength: parsed.text.length,
          });
          parsed.segments = [{
            start: 0,
            end: parsed.duration ?? 0,
            text: parsed.text,
          }];
        }
      }
      
      return parsed;
    } catch (e) {
      const errorMsg = `Nexara: invalid JSON response: ${String(e)}; body=${text.slice(0, 4000)}`;
      this.deps.log?.error("Nexara API: ошибка парсинга JSON", { error: String(e), textPreview: text.slice(0, 1000) });
      throw new Error(errorMsg);
    }
  }

  /**
   * Отправка multipart/form-data через requestUrl (для Obsidian).
   */
  private async fetchWithMultipartFormData(
    url: string,
    form: FormData,
    headers: Record<string, string>,
  ): Promise<Response> {
    const boundary = `----WebKitFormBoundary${Math.random().toString(16).slice(2)}`;
    const parts: Uint8Array[] = [];

    // Используем Array.from для обхода FormData (TypeScript может не знать о entries())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entries = Array.from((form as any).entries() as Iterable<[string, string | File | Blob]>);
    for (const [key, value] of entries) {
      const partHeader = `--${boundary}\r\nContent-Disposition: form-data; name="${key}"`;
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((value as any) instanceof File || value instanceof Blob) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fileValue = value as File | Blob;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fileName = (value as any) instanceof File ? (value as any).name : "file";
        const fileData = await fileValue.arrayBuffer();
        const header = `${partHeader}; filename="${fileName}"\r\nContent-Type: ${fileValue.type || "application/octet-stream"}\r\n\r\n`;
        parts.push(new TextEncoder().encode(header));
        parts.push(new Uint8Array(fileData));
      } else {
        const header = `${partHeader}\r\n\r\n${String(value)}\r\n`;
        parts.push(new TextEncoder().encode(header));
      }
    }

    const footer = `\r\n--${boundary}--\r\n`;
    parts.push(new TextEncoder().encode(footer));

    // Объединяем все части
    const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }

    const multipartHeaders = {
      ...headers,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    };

    const res = await requestUrl({
      url,
      method: "POST",
      headers: multipartHeaders,
      body: result.buffer,
      throw: false,
    });

    const status = Number(res.status) || 0;
    const noBody = (status >= 100 && status < 200) || status === 204 || status === 205 || status === 304;
    
    // requestUrl возвращает text или arrayBuffer. Для JSON ответов используем text.
    let responseBody: string | ArrayBuffer | null = null;
    if (!noBody) {
      // Если есть text, используем его (для JSON ответов)
      if (res.text) {
        responseBody = res.text;
      } else if (res.arrayBuffer) {
        responseBody = res.arrayBuffer;
      }
    }

    // Создаем Response с текстом или ArrayBuffer
    if (typeof responseBody === "string") {
      return new Response(responseBody, {
        status: res.status,
        headers: res.headers,
      });
    }

    return new Response(responseBody as any, {
      status: res.status,
      headers: res.headers,
    });
  }
}

