import { NexaraClient } from "./nexaraClient";
import type { TranscriptionProvider, TranscriptionResult } from "./transcriptionTypes";

const NEXARA_API_BASE_URL = "https://api.nexara.ru/api/v1";

type Logger = {
  info: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

export class NexaraTranscriptionProvider implements TranscriptionProvider {
  readonly id = "nexara";

  constructor(
    private readonly deps: {
      fetch: typeof fetch;
      token: string;
      log?: Logger;
    },
  ) {}

  async transcribe(params: { fileBlob: Blob; fileName: string }): Promise<TranscriptionResult> {
    const nx = new NexaraClient({
      fetch: this.deps.fetch,
      apiBaseUrl: NEXARA_API_BASE_URL,
      token: this.deps.token,
      log: this.deps.log,
    });
    const resp = await nx.transcribeVerboseJson({ fileBlob: params.fileBlob, fileName: params.fileName, timestamps: "segment" });
    const segs = Array.isArray(resp.segments) ? resp.segments : [];
    
    this.deps.log?.info("Nexara: обработка ответа", {
      segmentsCount: segs.length,
      hasText: !!resp.text,
      language: resp.language,
    });
    
    const result = {
      segments: segs
        .map((s) => ({
          startSec: typeof s.start === "number" ? s.start : 0,
          endSec: typeof s.end === "number" ? s.end : typeof s.start === "number" ? s.start : 0,
          text: String(s.text ?? "").trim(),
          speaker: typeof s.speaker === "string" ? s.speaker : undefined, // Сохраняем speaker из диаризации
        }))
        .filter((x) => x.text.length > 0),
      language: resp.language,
      duration: resp.duration,
    };
    
    this.deps.log?.info("Nexara: результат транскрипции", {
      segmentsCount: result.segments.length,
      totalTextLength: result.segments.reduce((sum, s) => sum + s.text.length, 0),
    });
    
    return result;
  }
}

