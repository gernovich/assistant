import { describe, expect, it } from "vitest";
import { ensureMarkdownFilePath } from "../../src/domain/policies/ensureMarkdownFilePath";

describe("ensureMarkdownFilePath", () => {
  it("adds .md when missing", () => {
    expect(ensureMarkdownFilePath("A/B")).toBe("A/B.md");
    expect(ensureMarkdownFilePath("A")).toBe("A.md");
  });

  it("keeps .md", () => {
    expect(ensureMarkdownFilePath("A/B.md")).toBe("A/B.md");
  });

  it("trims and handles empty", () => {
    expect(ensureMarkdownFilePath("  A  ")).toBe("A.md");
    expect(ensureMarkdownFilePath("")).toBe("");
  });
});

