import { describe, expect, it } from "vitest";
import { buildRecordingWindowHtml } from "../../src/presentation/electronWindow/recording/recordingWindowHtml";

describe("recordingWindowHtml", () => {
  it("использует Electron IPC transport (assistant/window/request) без title fallback", () => {
    const html = buildRecordingWindowHtml({
      defaultOccurrenceKey: "cal:id",
      optionsHtml: "<option></option>",
      meetingOptionsHtml: "<option></option>",
      protocolOptionsHtml: "<option></option>",
      lockDefaultEvent: true,
      autoEnabled: true,
      autoSeconds: 5,
      lockedLabel: "x",
      meta: [],
      hostWebContentsId: 123,
    });

    expect(html).toContain('window.__assistantElectron.sendTo(hostId, "assistant/window/request", req)');
    expect(html).not.toContain("document.title");
  });
});
