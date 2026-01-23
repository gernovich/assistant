import type { AssistantSettings, Event } from "../types";
import type { RecordingStats } from "../application/recording/recordingUseCase";
import type { RecordingFacade } from "../application/recording/recordingFacade";
import { RecordingVizHub } from "./recordingVizHub";
import type { Result } from "../shared/result";

export type RecordingStatus = "idle" | "recording" | "paused";
export type { RecordingStats };

/**
 * Facade-слой для записи.
 *
 * Зачем: оставить прежний публичный API (используется UI/окнами), но перенести state machine в Application (`RecordingUseCase`).
 */
export class RecordingService {
  constructor(
    private readonly deps: {
      facade: RecordingFacade;
      viz: RecordingVizHub;
    },
  ) {}

  setSettings(settings: AssistantSettings) {
    this.deps.facade.setSettings(settings);
  }

  setOnStats(cb?: (s: RecordingStats) => void) {
    this.deps.facade.setOnStats(cb);
  }

  setOnViz(cb?: (amp01: number) => void) {
    this.deps.viz.set(cb);
  }

  getStats(): RecordingStats {
    return this.deps.facade.getStats();
  }

  updateProcessingStats(stats: { filesRecognized?: number; foundProjects?: number; foundFacts?: number; foundPeople?: number }): void {
    this.deps.facade.updateProcessingStats(stats);
  }

  async start(params: { ev?: Event; eventKey?: string; protocolFilePath?: string }): Promise<void> {
    await this.deps.facade.start(params);
  }

  async startResult(params: { ev?: Event; eventKey?: string; protocolFilePath?: string }): Promise<Result<void>> {
    return await this.deps.facade.startResult(params);
  }

  async pause(): Promise<void> {
    await this.deps.facade.pause();
  }

  async pauseResult(): Promise<Result<void>> {
    return await this.deps.facade.pauseResult();
  }

  async resume(): Promise<void> {
    await this.deps.facade.resume();
  }

  async resumeResult(): Promise<Result<void>> {
    return await this.deps.facade.resumeResult();
  }

  async stop(): Promise<void> {
    await this.deps.facade.stop();
    this.deps.viz.tryPush(0);
  }

  async stopResult(): Promise<Result<void>> {
    const r = await this.deps.facade.stopResult();
    // даже при ошибке стопа пытаемся очистить визуализацию
    this.deps.viz.tryPush(0);
    return r;
  }
}

