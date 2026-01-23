import { describe, expect, it } from "vitest";
import { renderEmptyProtocolMarkdown } from "../../src/domain/policies/protocolNoteTemplate";

describe("domain/policies/protocolNoteTemplate", () => {
  it("рендерит пустой протокол", () => {
    const md = renderEmptyProtocolMarkdown({
      id: "manual:uid",
      startIso: "2026-01-01T00:00:00.000Z",
      keys: {
        assistantType: "assistant_type",
        protocolId: "protocol_id",
        calendarId: "calendar_id",
        start: "start",
        end: "end",
        summary: "summary",
        transcript: "transcript",
        files: "files",
        participants: "participants",
        projects: "projects",
      },
      escape: (s) => s,
    });
    expect(md).toContain("assistant_type: protocol");
    expect(md).toContain("protocol_id: manual:uid");
    expect(md).toContain("calendar_id: manual");
    expect(md).toContain("## Протокол");
  });
});
