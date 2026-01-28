import { NexaraClient } from "./nexaraClient";
import type { TranscriptionProvider, TranscriptionResult } from "./transcriptionTypes";

const NEXARA_API_BASE_URL = "https://api.nexara.ru/api/v1";

export class NexaraTranscriptionProvider implements TranscriptionProvider {
  readonly id = "nexara";

  constructor(
    private readonly deps: {
      fetch: typeof fetch;
      token: string;
    },
  ) {}

  async transcribe(params: { fileBlob: Blob; fileName: string }): Promise<TranscriptionResult> {
    const nx = new NexaraClient({
      fetch: this.deps.fetch,
      apiBaseUrl: NEXARA_API_BASE_URL,
      token: this.deps.token,
    });
    const resp = await nx.transcribeVerboseJson({ fileBlob: params.fileBlob, fileName: params.fileName, timestamps: "segment" });
    const segs = Array.isArray(resp.segments) ? resp.segments : [];
    return {
      segments: segs
        .map((s) => ({
          startSec: typeof s.start === "number" ? s.start : 0,
          endSec: typeof s.end === "number" ? s.end : typeof s.start === "number" ? s.start : 0,
          text: String(s.text ?? "").trim(),
        }))
        .filter((x) => x.text.length > 0),
    };
  }
}

