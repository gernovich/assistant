import { describe, expect, it } from "vitest";
import { linuxNativeFilterGraphPolicy } from "../../src/domain/policies/ffmpegFilterGraph";

describe("domain/policies/ffmpegFilterGraph", () => {
  it("returns base graphs for micOnly/withMonitor", () => {
    const g = linuxNativeFilterGraphPolicy("none", false);
    expect(g.withMonitor).toContain("amix=inputs=2");
    expect(g.micOnly).toContain("[0:a]");
    expect(g.withMonitorViz).toBeUndefined();
  });

  it("returns viz graphs when requested", () => {
    const g = linuxNativeFilterGraphPolicy("normalize", true);
    expect(g.withMonitorViz).toContain("[viz]");
    expect(g.micOnlyViz).toContain("[viz]");
  });
});

