import type { AssistantSettings, Event } from "../../types";
import { recordingBackendFromSettings } from "../../domain/policies/recordingBackend";
import { recordingFilePrefixFromEventKey } from "../../domain/policies/recordingFileNaming";
import { DEFAULT_RECORDINGS_DIR } from "../../domain/policies/recordingPaths";
import type { RecordingBackendId, RecordingStats, RecordingUseCase } from "./recordingUseCase";
import { err, ok, type Result } from "../../shared/result";
import { APP_ERROR } from "../../shared/appErrorCodes";

type Logger = {
  info: (message: string, data?: Record<string, unknown>) => void;
};

/**
 * Application facade для записи:
 * - собирает start-параметры из settings (backend/chunk/prefix/dir/mimeTypePref)
 * - делегирует state machine в `RecordingUseCase`
 *
 * Зачем: держать оставшуюся orchestration вне `RecordingService` (Infrastructure).
 */
export class RecordingFacade {
  private settings: AssistantSettings;

  constructor(
    private readonly deps: {
      useCase: RecordingUseCase;
      pickMimeTypePref: () => string;
      log: Logger;
    },
    initialSettings: AssistantSettings,
  ) {
    this.settings = initialSettings;
  }

  setSettings(settings: AssistantSettings): void {
    this.settings = settings;
  }

  getStats(): RecordingStats {
    return this.deps.useCase.getStats();
  }

  setOnStats(cb?: (s: RecordingStats) => void): void {
    this.deps.useCase.setOnStats(cb);
  }

  updateProcessingStats(stats: { filesRecognized?: number; foundProjects?: number; foundFacts?: number; foundPeople?: number }): void {
    this.deps.useCase.updateProcessingStats(stats);
  }

  async startResult(params: { ev?: Event; eventKey?: string; protocolFilePath?: string }): Promise<Result<void>> {
    try {
      await this.start(params);
      return ok(undefined);
    } catch (e) {
      const raw = String((e as unknown) ?? "неизвестная ошибка");
      const short = raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
      return err({
        code: APP_ERROR.RECORDING_BACKEND,
        message: `Ассистент: не удалось запустить запись: ${short}. Подробности в логе.`,
        cause: raw,
        details: { eventKey: params.eventKey, protocolFilePath: params.protocolFilePath },
      });
    }
  }

  async pauseResult(): Promise<Result<void>> {
    try {
      await this.pause();
      return ok(undefined);
    } catch (e) {
      const raw = String((e as unknown) ?? "неизвестная ошибка");
      return err({ code: APP_ERROR.RECORDING_BACKEND, message: "Ассистент: не удалось поставить запись на паузу", cause: raw });
    }
  }

  async resumeResult(): Promise<Result<void>> {
    try {
      await this.resume();
      return ok(undefined);
    } catch (e) {
      const raw = String((e as unknown) ?? "неизвестная ошибка");
      return err({ code: APP_ERROR.RECORDING_BACKEND, message: "Ассистент: не удалось продолжить запись", cause: raw });
    }
  }

  async stopResult(): Promise<Result<void>> {
    try {
      await this.stop();
      return ok(undefined);
    } catch (e) {
      const raw = String((e as unknown) ?? "неизвестная ошибка");
      return err({ code: APP_ERROR.RECORDING_BACKEND, message: "Ассистент: не удалось остановить запись", cause: raw });
    }
  }

  async start(params: { ev?: Event; eventKey?: string; protocolFilePath?: string }): Promise<void> {
    const backend: RecordingBackendId = recordingBackendFromSettings(this.settings.recording.audioBackend);
    const chunkMinutes = Math.max(1, Math.floor(Number(this.settings.recording.chunkMinutes || 5)));
    const chunkEveryMs = chunkMinutes * 60_000;
    const recordingsDir = DEFAULT_RECORDINGS_DIR;
    const filePrefix = recordingFilePrefixFromEventKey(params.eventKey);
    const mimeTypePref = this.deps.pickMimeTypePref();

    this.deps.log.info("Recording: start()", {
      backend,
      chunkMinutes,
      processing: this.settings.recording.linuxNativeAudioProcessing ?? "normalize",
      eventKey: params.eventKey,
      protocolFilePath: params.protocolFilePath,
    });

    await this.deps.useCase.start({
      backend,
      recordingsDir,
      filePrefix,
      mimeTypePref,
      chunkEveryMs,
      eventKey: params.eventKey,
      protocolFilePath: params.protocolFilePath,
    });
  }

  async pause(): Promise<void> {
    await this.deps.useCase.pause();
  }

  async resume(): Promise<void> {
    await this.deps.useCase.resume();
  }

  async stop(): Promise<void> {
    await this.deps.useCase.stop();
  }
}
