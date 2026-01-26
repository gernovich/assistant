import { describe, expect, it } from "vitest";
import { buildReminderWindowHtml } from "../../src/presentation/electronWindow/reminder/reminderWindowHtml";

describe("reminderWindowHtml", () => {
  it("использует WindowTransport (window/request) без title fallback", () => {
    const html = buildReminderWindowHtml({
      kind: "before",
      hostWebContentsId: 123,
      cspConnectSrc: ["ws://127.0.0.1:*"],
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

    expect(html).toContain('transport.send({ type: "window/request", payload: req })');
    expect(html).not.toContain("document.title");
  });
});
