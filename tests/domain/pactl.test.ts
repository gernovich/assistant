import { describe, expect, it } from "vitest";
import {
  buildPulseMicCandidates,
  buildPulseMonitorCandidates,
  parsePactlDefaultSinkFromInfo,
  parsePactlDefaultSourceFromInfo,
} from "../../src/domain/policies/pactl";

describe("domain/policies/pactl", () => {
  it("parses Default Sink/Source from pactl info", () => {
    const info = "Default Sink: sinkA\nDefault Source: srcB\n";
    expect(parsePactlDefaultSinkFromInfo(info)).toBe("sinkA");
    expect(parsePactlDefaultSourceFromInfo(info)).toBe("srcB");
  });

  it("builds monitor candidates from sources list + default sink", () => {
    const sources = ["1 sinkA.monitor module RUNNING", "2 sinkB.monitor module IDLE", "3 mic module RUNNING"].join("\n");
    const cands = buildPulseMonitorCandidates({
      sourcesStdout: sources,
      defaultSinkFromInfo: "sinkA",
    });
    expect(cands[0]).toBe("sinkA.monitor");
    expect(cands).toContain("@DEFAULT_MONITOR@");
  });

  it("builds mic candidates from default source + aliases", () => {
    const c = buildPulseMicCandidates({ defaultSourceFromInfo: "srcX" });
    expect(c[0]).toBe("srcX");
    expect(c).toContain("@DEFAULT_SOURCE@");
  });
});
