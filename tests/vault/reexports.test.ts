import { describe, expect, test } from "vitest";

import { parseMeetingNoteFromMd } from "../../src/vault/frontmatterDtos";
import { extractWikiLinkTargets } from "../../src/vault/markdownSections";
import { yamlEscape } from "../../src/vault/yamlEscape";

describe("vault re-export modules", () => {
  test("frontmatterDtos re-export works (parseMeetingNoteFromMd)", () => {
    const md = [
      "---",
      "assistant_type: calendar_event",
      "calendar_id: cal1",
      "event_id: ev1",
      "summary: Demo",
      "start: 2026-01-23T10:00:00.000Z",
      "---",
      "",
      "body",
    ].join("\n");

    const r = parseMeetingNoteFromMd(md);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.calendar_id).toBe("cal1");
    expect(r.value.event_id).toBe("ev1");
    expect(r.value.summary).toBe("Demo");
  });

  test("markdownSections re-export works (extractWikiLinkTargets)", () => {
    expect(extractWikiLinkTargets("See [[A]]\nAnd [[B|label]]")).toEqual(["A", "B"]);
  });

  test("yamlEscape re-export works", () => {
    expect(yamlEscape("a\nb")).toBe("\"a b\"");
  });
});

