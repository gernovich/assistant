import { describe, expect, it } from "vitest";
import { recordingExtFromMimeType } from "../../src/domain/policies/recordingExt";

describe("domain/policies/recordingExt", () => {
  it("returns ogg when mime includes ogg", () => {
    expect(recordingExtFromMimeType("audio/ogg;codecs=opus")).toBe("ogg");
  });

  it("defaults to webm otherwise", () => {
    expect(recordingExtFromMimeType("audio/webm")).toBe("webm");
    expect(recordingExtFromMimeType("")).toBe("webm");
  });
});

