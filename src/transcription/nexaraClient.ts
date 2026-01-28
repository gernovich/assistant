export type NexaraVerboseJsonSegment = {
  id?: number;
  start?: number; // seconds
  end?: number; // seconds
  text?: string;
};

export type NexaraVerboseJsonResponse = {
  text?: string;
  language?: string;
  duration?: number;
  segments?: NexaraVerboseJsonSegment[];
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class NexaraClient {
  constructor(
    private readonly deps: {
      fetch: FetchLike;
      apiBaseUrl: string; // e.g. https://api.nexara.ru/api/v1
      token: string;
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

    const token = String(this.deps.token || "");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const r = await this.deps.fetch(url, {
      method: "POST",
      headers,
      body: form as any,
    });

    const text = await r.text().catch(() => "");
    if (!r.ok) {
      throw new Error(`Nexara HTTP ${r.status}: ${text || r.statusText}`);
    }

    try {
      return JSON.parse(text) as NexaraVerboseJsonResponse;
    } catch (e) {
      throw new Error(`Nexara: invalid JSON response: ${String(e)}; body=${text.slice(0, 4000)}`);
    }
  }
}

