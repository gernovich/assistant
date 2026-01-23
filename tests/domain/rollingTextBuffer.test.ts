import { describe, expect, it } from "vitest";
import { appendRollingText, splitLinesKeepRemainder } from "../../src/domain/policies/rollingTextBuffer";

describe("domain/policies/rollingTextBuffer", () => {
  it("appendRollingText truncates to maxChars", () => {
    expect(appendRollingText({ prev: "abc", chunk: "def", maxChars: 4 })).toBe("cdef");
  });

  it("splitLinesKeepRemainder keeps last partial line", () => {
    const r = splitLinesKeepRemainder("a\r\nb\rpart");
    expect(r.lines).toEqual(["a", "b"]);
    expect(r.remainder).toBe("part");
  });
});
