import type { Event } from "../../types";
import type { RecordingService, RecordingStats } from "../../recording/recordingService";
import type { Result } from "../../shared/result";

export type RecordingController = {
  setOnStats: (cb?: (s: RecordingStats) => void) => void;
  setOnViz: (cb?: (p: { mic01: number; monitor01: number }) => void) => void;
  getStats: () => RecordingStats;
  start: (params: { ev?: Event; eventKey?: string; protocolFilePath?: string }) => Promise<void>;
  startResult: (params: { ev?: Event; eventKey?: string; protocolFilePath?: string }) => Promise<Result<void>>;
  stop: () => Promise<void>;
  stopResult: () => Promise<Result<void>>;
  pause: () => Promise<void>;
  pauseResult: () => Promise<Result<void>>;
  resume: () => Promise<void>;
  resumeResult: () => Promise<Result<void>>;
};

/**
 * Default adapter: RecordingController поверх текущего RecordingService.
 *
 * Зачем: Presentation (RecordingDialog) должен зависеть от порта, а не от инфраструктурного фасада.
 */
export class DefaultRecordingController implements RecordingController {
  constructor(private readonly svc: RecordingService) {}

  setOnStats(cb?: (s: RecordingStats) => void): void {
    this.svc.setOnStats(cb);
  }

  setOnViz(cb?: (p: { mic01: number; monitor01: number }) => void): void {
    this.svc.setOnViz(cb);
  }

  getStats(): RecordingStats {
    return this.svc.getStats();
  }

  async start(params: { ev?: Event; eventKey?: string; protocolFilePath?: string }): Promise<void> {
    await this.svc.start(params);
  }

  async startResult(params: { ev?: Event; eventKey?: string; protocolFilePath?: string }): Promise<Result<void>> {
    return await this.svc.startResult(params);
  }

  async stop(): Promise<void> {
    await this.svc.stop();
  }

  async stopResult(): Promise<Result<void>> {
    return await this.svc.stopResult();
  }

  async pause(): Promise<void> {
    await this.svc.pause();
  }

  async pauseResult(): Promise<Result<void>> {
    return await this.svc.pauseResult();
  }

  async resume(): Promise<void> {
    await this.svc.resume();
  }

  async resumeResult(): Promise<Result<void>> {
    return await this.svc.resumeResult();
  }
}
