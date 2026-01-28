import { describe, expect, it } from "vitest";
import { formatHhMmSsMs, formatSegmentsMarkdown } from "../../src/transcription/transcriptFormat";

describe("transcriptFormat", () => {
  it("formatHhMmSsMs formats mm:ss.mmm and hh:mm:ss.mmm", () => {
    expect(formatHhMmSsMs(0)).toBe("00:00.000");
    expect(formatHhMmSsMs(1.234)).toBe("00:01.234");
    expect(formatHhMmSsMs(61.005)).toBe("01:01.005");
    expect(formatHhMmSsMs(3601.002)).toBe("01:00:01.002");
  });

  it("formatSegmentsMarkdown renders segments with timestamps", () => {
    const md = formatSegmentsMarkdown({
      fileLabel: "a.ogg",
      segments: [{ startSec: 0.0, endSec: 1.5, text: "привет" }],
    });
    expect(md).toContain("#### Расшифровка: a.ogg");
    expect(md).toContain("- 00:00.000–00:01.500 привет");
  });
});

