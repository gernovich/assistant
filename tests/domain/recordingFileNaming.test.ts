import { describe, expect, it } from "vitest";
import {
  isoTimestampForFileName,
  recordingChunkFileName,
  recordingFilePrefixFromEventKey,
} from "../../src/domain/policies/recordingFileNaming";

describe("domain/policies/recordingFileNaming", () => {
  it("recordingFilePrefixFromEventKey sanitizes", () => {
    expect(recordingFilePrefixFromEventKey("a b")).toBe("a_b");
  });

  it("isoTimestampForFileName replaces ':' and '.'", () => {
    expect(isoTimestampForFileName("2026-01-01T10:00:00.123Z")).toBe("2026-01-01T10-00-00-123Z");
  });

  it("recordingChunkFileName composes parts", () => {
    expect(recordingChunkFileName({ prefix: "p", iso: "2026-01-01T00:00:00.000Z", ext: "ogg" })).toBe("p-2026-01-01T00-00-00-000Z.ogg");
  });
});
