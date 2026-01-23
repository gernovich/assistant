import { describe, expect, it } from "vitest";
import { decideMeetingNoteFile } from "../../src/domain/policies/meetingNoteFileDecision";

describe("decideMeetingNoteFile", () => {
  it("uses existing by eventKey; suggests rename if target differs", () => {
    expect(decideMeetingNoteFile({ targetPath: "A.md", existingByEventKeyPath: "A.md" })).toEqual({ kind: "use_eventKey" });
    expect(decideMeetingNoteFile({ targetPath: "B.md", existingByEventKeyPath: "A.md" })).toEqual({
      kind: "use_eventKey",
      renameTo: "B.md",
    });
  });

  it("uses legacy sid when eventKey missing; suggests rename and indexes eventKey", () => {
    expect(decideMeetingNoteFile({ targetPath: "A.md", existingByLegacySidPath: "A.md" })).toEqual({
      kind: "use_legacy_sid",
      shouldIndexEventKey: true,
    });
    expect(decideMeetingNoteFile({ targetPath: "B.md", existingByLegacySidPath: "A.md" })).toEqual({
      kind: "use_legacy_sid",
      shouldIndexEventKey: true,
      renameTo: "B.md",
    });
  });

  it("creates new when nothing found", () => {
    expect(decideMeetingNoteFile({ targetPath: "A.md" })).toEqual({ kind: "create_new", shouldIndexEventKey: true });
  });
});

