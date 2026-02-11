import { describe, expect, it } from "vitest";
import { formatHhMmSsMs, formatSegmentsMarkdown } from "../../src/transcription/transcriptFormat";

describe("transcriptFormat", () => {
  it("formatHhMmSsMs formats mm:ss.mmm and hh:mm:ss.mmm", () => {
    expect(formatHhMmSsMs(0)).toBe("00:00.000");
    expect(formatHhMmSsMs(1.234)).toBe("00:01.234");
    expect(formatHhMmSsMs(61.005)).toBe("01:01.005");
    expect(formatHhMmSsMs(3601.002)).toBe("01:00:01.002");
  });

  it("formatSegmentsMarkdown renders segments with bold start time", () => {
    const md = formatSegmentsMarkdown({
      fileLabel: "a.ogg",
      segments: [
        { startSec: 0.0, endSec: 1.5, text: "привет" },
        { startSec: 23.24, endSec: 46.88, text: "второй сегмент" },
      ],
    });
    expect(md).toContain("#### Расшифровка");
    expect(md).toContain("- **00:00.000**  привет");
    expect(md).toContain("- **00:23.240**  второй сегмент");
  });

  it("formatSegmentsMarkdown includes [[speaker_X]] when segment has speaker", () => {
    const md = formatSegmentsMarkdown({
      fileLabel: "a.ogg",
      segments: [
        { startSec: 0, endSec: 5, text: "привет", speaker: "speaker_0" },
        { startSec: 5, endSec: 10, text: "ответ", speaker: "speaker_1" },
        { startSec: 10, endSec: 15, text: "без спикера" },
      ],
    });
    expect(md).toContain("- **00:00.000** [[speaker_0]]  привет");
    expect(md).toContain("- **00:05.000** [[speaker_1]]  ответ");
    expect(md).toContain("- **00:10.000**  без спикера");
  });

  it("formatSegmentsMarkdown adds meta comment with start, end, person_id, voiceprint", () => {
    const md = formatSegmentsMarkdown({
      segments: [
        { startSec: 0, endSec: 23.24, text: "первый", speaker: "speaker_0" },
        { startSec: 23.24, endSec: 46.88, text: "второй", personId: "person-1", voiceprint: "vp1" },
      ],
    });
    expect(md).toContain("start: \"00:00.000\"");
    expect(md).toContain("end: \"00:23.240\"");
    expect(md).toContain("person_id: ~");
    expect(md).toContain("voiceprint: ~");
    expect(md).toContain("person_id: \"person-1\"");
    expect(md).toContain("voiceprint: \"vp1\"");
  });
});

