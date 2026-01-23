import { describe, expect, it } from "vitest";
import { buildReminderWindowHtml } from "../../src/presentation/electronWindow/reminder/reminderWindowHtml";

describe("reminderWindowHtml", () => {
  it("использует Electron IPC transport (assistant/window/request) без title fallback", () => {
    const html = buildReminderWindowHtml({
      kind: "before",
      hostWebContentsId: 123,
      initialStatusLine: "Через 00:10",
      initialTitleLine: "Meeting",
      detailsText: "Начало: ...",
      startIso: new Date().toISOString(),
      endIso: "",
      summary: "Meeting",
      location: "",
      urlLink: "",
      minutesBefore: 5,
    });

    expect(html).toContain("window.__assistantElectron.sendTo(hostId, \"assistant/window/request\", req)");
    expect(html).not.toContain("document.title");
  });
});

