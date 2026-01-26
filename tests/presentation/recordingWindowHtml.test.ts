import { describe, expect, it } from "vitest";
import { buildRecordingWindowHtml } from "../../src/presentation/electronWindow/recording/recordingWindowHtml";

describe("recordingWindowHtml", () => {
  it("использует WindowTransport (window/request) без title fallback", () => {
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
      debugEnabled: false,
      cspConnectSrc: null,
    });

    expect(html).toContain('transport.send({ type: "window/request", payload: req })');
    expect(html).not.toContain("document.title");
  });

  it("останавливает визуализацию при stop и игнорирует viz во время stop", () => {
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
      debugEnabled: false,
      cspConnectSrc: null,
    });

    expect(html).toContain("resetVizState()");
    expect(html).toContain("state.switchingKind === \"stop\"");
    expect(html).toContain("stopDrawLoop()");
  });
});
