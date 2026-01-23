import { describe, expect, it } from "vitest";
import { buildLinuxNativeSourceAttemptPlan } from "../../src/domain/policies/linuxNativeSourcePlan";

describe("domain/policies/linuxNativeSourcePlan", () => {
  it("produces mic×monitor attempts in order", () => {
    const a = buildLinuxNativeSourceAttemptPlan({ micCandidates: ["m1"], monitorCandidates: ["x", "y"] });
    expect(a).toEqual([
      { mic: "m1", monitor: "x" },
      { mic: "m1", monitor: "y" },
    ]);
  });
});
