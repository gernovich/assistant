import type { App } from "obsidian";
import type { AssistantSettings } from "../../types";
import { FM } from "../../domain/policies/frontmatterKeys";
import { parseJsonStringArray } from "../../domain/policies/frontmatterJsonArrays";
import { parseFrontmatterMap, splitFrontmatter } from "../../vault/frontmatter";
import { formatSegmentsMarkdown } from "../../transcription/transcriptFormat";
import { ProtocolTranscriptionService } from "../../transcription/protocolTranscriptionService";
import { NexaraTranscriptionProvider } from "../../transcription/nexaraTranscriptionProvider";
import type { TranscriptionProvider } from "../../transcription/transcriptionTypes";

type Logger = {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

type IntervalId = number | ReturnType<typeof globalThis.setInterval>;

export class TranscriptionSchedulerUseCase {
  private timerId?: IntervalId;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly deps: {
      app: App;
      getSettings: () => AssistantSettings;
      setInterval: (fn: () => void, ms: number) => IntervalId;
      clearInterval: (id: IntervalId) => void;
      log: Logger;
      fetch: typeof fetch;
    },
  ) {}

  stop(): void {
    if (this.timerId) this.deps.clearInterval(this.timerId);
    this.timerId = undefined;
    this.inFlight = null;
  }

  setup(): void {
    this.stop();

    const s = this.deps.getSettings();
    if (!s.transcription?.enabled) {
      this.deps.log.info("Транскрибация: выключено");
      return;
    }
    const provider = this.getProviderOrNull(s);
    if (!provider) return;

    const minutes = Math.max(1, Number(s.transcription.pollMinutes || 20));
    const intervalMs = Math.floor(minutes * 60_000);
    this.deps.log.info("Транскрибация: включено", { minutes });

    // стартуем сразу (best effort)
    void this.tick();

    this.timerId = this.deps.setInterval(() => {
      void this.tick();
    }, intervalMs);
  }

  /** Запустить один проход “прямо сейчас” (без ожидания таймера). */
  async runNow(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = this.runOnce().finally(() => {
      this.inFlight = null;
    });
    await this.inFlight;
  }

  private async runOnce(): Promise<void> {
    const s = this.deps.getSettings();
    if (!s.transcription?.enabled) return;

    const protocolsRoot = String(s.folders.protocols || "").replace(/\/+$/g, "");
    const rootPrefix = protocolsRoot ? `${protocolsRoot}/` : "";
    const mdFiles = (this.deps.app.vault.getMarkdownFiles?.() ?? []).filter((f: any) => String(f?.path || "").startsWith(rootPrefix));

    // Ограничим за один тик, чтобы не подвешивать UI на огромном vault.
    const maxPerTick = 5;
    let doneCount = 0;

    const protoSvc = new ProtocolTranscriptionService(this.deps.app);
    const provider = this.getProviderOrNull(s);
    if (!provider) return;

    for (const file of mdFiles) {
      if (doneCount >= maxPerTick) break;
      try {
        let fm = (this.deps.app.metadataCache?.getFileCache?.(file as any)?.frontmatter as any) ?? null;
        if (!fm || typeof fm !== "object") {
          // fallback: metadataCache мог ещё не прогреться
          fm = await readFrontmatterFallback(this.deps.app, file);
        }
        const filesRaw = fm[FM.files];
        const transcriptRaw = fm[FM.transcript];

        const recFiles = Array.isArray(filesRaw)
          ? (filesRaw as unknown[]).filter((x) => typeof x === "string") as string[]
          : typeof filesRaw === "string"
            ? parseJsonStringArray(filesRaw)
            : [];

        const transcribed = Array.isArray(transcriptRaw)
          ? (transcriptRaw as unknown[]).filter((x) => typeof x === "string") as string[]
          : typeof transcriptRaw === "string"
            ? parseJsonStringArray(transcriptRaw)
            : [];

        const pending = recFiles.find((p) => !transcribed.includes(p));
        if (!pending) continue;

        // Читаем бинарь из vault
        const ab = await (this.deps.app.vault.adapter as any).readBinary(pending);
        const blob = new Blob([ab]);
        const fileName = (pending.split("/").pop() || "audio.ogg").trim() || "audio.ogg";

        this.deps.log.info("Транскрибация: запрос", { provider: provider.id, protocol: String(file?.path || ""), file: pending });

        const resp = await provider.transcribe({ fileBlob: blob, fileName });
        const transcriptMd = formatSegmentsMarkdown({ segments: resp.segments, fileLabel: fileName });

        await protoSvc.markFileTranscribedAndAppend({
          protocolFilePath: String(file?.path || ""),
          recordingFilePath: pending,
          transcriptMd,
        });

        doneCount += 1;
      } catch (e) {
        this.deps.log.error("Транскрибация: ошибка", { error: String(e) });
      }
    }
  }

  private getProviderOrNull(s: AssistantSettings): TranscriptionProvider | null {
    const providerId = s.transcription?.provider === "nexara" ? "nexara" : "nexara";
    if (providerId === "nexara") {
      const token = getTokenOrEmpty(s);
      if (!token) {
        this.deps.log.warn("Транскрибация: включено, но Nexara token пустой — задачи не будут выполняться");
        return null;
      }
      return new NexaraTranscriptionProvider({ fetch: this.deps.fetch, token, log: this.deps.log });
    }
    this.deps.log.warn("Транскрибация: неизвестный провайдер", { providerId });
    return null;
  }
}

function getTokenOrEmpty(s: AssistantSettings): string {
  return String(s.transcription?.providers?.nexara?.token ?? "").trim();
}

async function readFrontmatterFallback(app: App, file: unknown): Promise<Record<string, unknown>> {
  try {
    const md = await app.vault.read(file as any);
    const { frontmatter } = splitFrontmatter(md);
    if (!frontmatter) return {};
    return parseFrontmatterMap(frontmatter) as any;
  } catch {
    return {};
  }
}

