import { describe, expect, it } from "vitest";
import { linuxNativeFfmpegArgsPolicy } from "../../src/domain/policies/linuxNativeFfmpegArgs";

describe("domain/policies/linuxNativeFfmpegArgs", () => {
  it("includes viz output when wantViz=true", () => {
    const args = linuxNativeFfmpegArgsPolicy({
      micName: "mic",
      monitorName: "mon",
      tmpPath: "/tmp/x.ogg",
      wantViz: true,
      processing: "normalize",
      filterGraph: { withMonitor: "G", withMonitorViz: "GV" },
    });
    expect(args.join(" ")).toContain("-filter_complex GV");
    expect(args.join(" ")).toContain("pipe:1");
  });
});

