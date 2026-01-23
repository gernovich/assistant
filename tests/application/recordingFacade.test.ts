import { describe, expect, it, vi } from "vitest";
import { RecordingFacade } from "../../src/application/recording/recordingFacade";
import { DEFAULT_SETTINGS } from "../../src/settingsStore";

describe("RecordingFacade Result boundary", () => {
  it("startResult: returns err(E_RECORDING_BACKEND) when useCase.start throws", async () => {
    const useCase = {
      setOnStats: vi.fn(),
      getStats: vi.fn().mockReturnValue({ status: "idle" }),
      updateProcessingStats: vi.fn(),
      start: vi.fn().mockRejectedValue(new Error("boom")),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    } as any;

    const facade = new RecordingFacade(
      {
        useCase,
        pickMimeTypePref: () => "audio/webm",
        log: { info: vi.fn() },
      },
      structuredClone(DEFAULT_SETTINGS),
    );

    const r = await facade.startResult({ eventKey: "c:e", protocolFilePath: "p.md" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("E_RECORDING_BACKEND");
      expect(String(r.error.cause)).toContain("boom");
    }
  });

  it("pauseResult/resumeResult/stopResult: returns err(E_RECORDING_BACKEND) when useCase throws", async () => {
    const useCase = {
      setOnStats: vi.fn(),
      getStats: vi.fn().mockReturnValue({ status: "idle" }),
      updateProcessingStats: vi.fn(),
      start: vi.fn(),
      pause: vi.fn().mockRejectedValue(new Error("pause boom")),
      resume: vi.fn().mockRejectedValue(new Error("resume boom")),
      stop: vi.fn().mockRejectedValue(new Error("stop boom")),
    } as any;

    const facade = new RecordingFacade(
      {
        useCase,
        pickMimeTypePref: () => "audio/webm",
        log: { info: vi.fn() },
      },
      structuredClone(DEFAULT_SETTINGS),
    );

    const p = await facade.pauseResult();
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error.code).toBe("E_RECORDING_BACKEND");

    const r = await facade.resumeResult();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_RECORDING_BACKEND");

    const s = await facade.stopResult();
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.error.code).toBe("E_RECORDING_BACKEND");
  });
});

