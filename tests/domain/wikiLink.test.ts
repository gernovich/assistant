import { describe, expect, it } from "vitest";
import { stripMarkdownExtension, wikiLinkLine } from "../../src/domain/policies/wikiLink";

describe("domain/policies/wikiLink", () => {
  it("stripMarkdownExtension: убирает .md (case-insensitive) только в конце", () => {
    expect(stripMarkdownExtension("a.md")).toBe("a");
    expect(stripMarkdownExtension("a.MD")).toBe("a");
    expect(stripMarkdownExtension("a.md.bak")).toBe("a.md.bak");
  });

  it("wikiLinkLine: формирует строку '- [[target|label]]' и убирает .md у target", () => {
    expect(wikiLinkLine({ targetPath: "Ассистент/Протоколы/p.md", label: "P" })).toBe("- [[Ассистент/Протоколы/p|P]]");
  });
});

