import { describe, expect, it } from "vitest";
import { nextChunkInMsPolicy, shouldRotateChunkPolicy } from "../../src/domain/policies/recordingChunkTiming";

describe("domain/policies/recordingChunkTiming", () => {
  it("shouldRotateChunkPolicy: rotate when now-last >= every", () => {
    expect(shouldRotateChunkPolicy({ nowMs: 1000, lastChunkAtMs: 0, chunkEveryMs: 1000 })).toBe(true);
    expect(shouldRotateChunkPolicy({ nowMs: 999, lastChunkAtMs: 0, chunkEveryMs: 1000 })).toBe(false);
  });

  it("nextChunkInMsPolicy: returns remaining time (never negative)", () => {
    expect(nextChunkInMsPolicy({ nowMs: 500, lastChunkAtMs: 0, chunkEveryMs: 1000 })).toBe(500);
    expect(nextChunkInMsPolicy({ nowMs: 2000, lastChunkAtMs: 0, chunkEveryMs: 1000 })).toBe(0);
  });
});

