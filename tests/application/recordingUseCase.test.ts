import { describe, expect, it, vi } from "vitest";
import { RecordingUseCase, type RecordingBackend, type RecordingBackendId } from "../../src/application/recording/recordingUseCase";

function makeFakeBackend(kind: RecordingBackendId): RecordingBackend & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async startSession() {
      calls.push("startSession");
      return { kind };
    },
    async startNewChunk() {
      calls.push("startNewChunk");
    },
    async finalizeCurrentFile() {
      calls.push("finalizeCurrentFile");
    },
    async stopSession() {
      calls.push("stopSession");
    },
  };
}

describe("RecordingUseCase", () => {
  it("start -> pause -> resume -> stop вызывает backend в ожидаемом порядке", async () => {
    const be = makeFakeBackend("electron_media_devices");
    const backends: Record<RecordingBackendId, RecordingBackend> = {
      electron_media_devices: be,
      linux_native: makeFakeBackend("linux_native"),
    };

    const uc = new RecordingUseCase({
      nowMs: () => 1000,
      setInterval: (cb) => {
        void cb;
        return 123;
      },
      clearInterval: () => undefined,
      shouldRotateChunk: () => false,
      nextChunkInMs: () => 0,
      ensureRecordingsDir: async () => undefined,
      backends,
    });

    await uc.start({
      backend: "electron_media_devices",
      recordingsDir: "Ассистент/Записи",
      filePrefix: "rec",
      chunkEveryMs: 60_000,
      eventKey: "cal:ev",
    });
    await uc.pause();
    await uc.resume();
    await uc.stop();

    expect(be.calls).toEqual(["startSession", "finalizeCurrentFile", "startNewChunk", "finalizeCurrentFile", "stopSession"]);
  });

  it("getStats отражает idle/recording/paused", async () => {
    const be = makeFakeBackend("linux_native");
    const uc = new RecordingUseCase({
      nowMs: () => 1000,
      setInterval: () => 1,
      clearInterval: () => undefined,
      shouldRotateChunk: () => false,
      nextChunkInMs: () => 123,
      ensureRecordingsDir: async () => undefined,
      backends: { electron_media_devices: makeFakeBackend("electron_media_devices"), linux_native: be },
    });

    expect(uc.getStats().status).toBe("idle");
    await uc.start({ backend: "linux_native", recordingsDir: "x", filePrefix: "p", chunkEveryMs: 1000 });
    expect(uc.getStats().status).toBe("recording");
    await uc.pause();
    expect(uc.getStats().status).toBe("paused");
  });

  it("stop: если finalizeCurrentFile кидает ошибку, use-case всё равно делает cleanup (idle) и пробует stopSession", async () => {
    const calls: string[] = [];
    const be: RecordingBackend = {
      async startSession() {
        calls.push("startSession");
        return { kind: "electron_media_devices" };
      },
      async startNewChunk() {
        calls.push("startNewChunk");
      },
      async finalizeCurrentFile() {
        calls.push("finalizeCurrentFile");
        throw new Error("finalize failed");
      },
      async stopSession() {
        calls.push("stopSession");
      },
    };

    const uc = new RecordingUseCase({
      nowMs: () => 1000,
      setInterval: () => 1,
      clearInterval: () => undefined,
      shouldRotateChunk: () => false,
      nextChunkInMs: () => 0,
      ensureRecordingsDir: async () => undefined,
      backends: { electron_media_devices: be, linux_native: makeFakeBackend("linux_native") },
    });

    await uc.start({ backend: "electron_media_devices", recordingsDir: "x", filePrefix: "p", chunkEveryMs: 1000 });
    await expect(uc.stop()).rejects.toThrow("finalize failed");
    expect(calls).toEqual(["startSession", "finalizeCurrentFile", "stopSession"]);
    expect(uc.getStats().status).toBe("idle");
  });
});

