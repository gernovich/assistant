import { describe, expect, it } from "vitest";
import { amp01FromLufsPolicy, amp01FromRmsPolicy, amp01FromTimeDomainRmsPolicy } from "../../src/domain/policies/recordingVizAmp";

describe("domain/policies/recordingVizAmp", () => {
  it("amp01FromLufsPolicy maps -70..-20 into 0..1", () => {
    expect(amp01FromLufsPolicy(-70)).toBe(0);
    expect(amp01FromLufsPolicy(-20)).toBe(1);
  });

  it("amp01FromRmsPolicy returns db and amp", () => {
    const { db, amp01raw } = amp01FromRmsPolicy(1);
    expect(db).toBeCloseTo(0, 6);
    expect(amp01raw).toBe(1);
  });

  it("amp01FromTimeDomainRmsPolicy clamps scaled RMS", () => {
    expect(amp01FromTimeDomainRmsPolicy(0.5, 2.2)).toBe(1);
  });
});
