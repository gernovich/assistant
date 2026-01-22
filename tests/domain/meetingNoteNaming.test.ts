import { describe, expect, it } from "vitest";
import { meetingNoteBaseName } from "../../src/domain/policies/meetingNoteNaming";

describe("domain/policies/meetingNoteNaming", () => {
  it("обрезает до maxLen", () => {
    const s = meetingNoteBaseName({
      summary: "0123456789",
      sanitizeFileName: (x) => x,
      maxLen: 5,
    });
    expect(s).toBe("01234");
  });

  it("использует sanitizeFileName", () => {
    const s = meetingNoteBaseName({
      summary: "Hello",
      sanitizeFileName: () => "X",
    });
    expect(s).toBe("X");
  });

  it("default maxLen=80 и минимум 1", () => {
    const s1 = meetingNoteBaseName({ summary: "A", sanitizeFileName: (x) => x });
    expect(s1).toBe("A");

    const s2 = meetingNoteBaseName({ summary: "AB", sanitizeFileName: (x) => x, maxLen: 0 });
    expect(s2).toBe("A");
  });
});

