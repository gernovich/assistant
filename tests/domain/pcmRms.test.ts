import { describe, expect, it } from "vitest";
import { rms01FromS16leMonoFrame } from "../../src/domain/policies/pcmRms";

describe("domain/policies/pcmRms", () => {
  it("computes RMS for a constant max signal", () => {
    const samples = 4;
    const buf = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) buf.writeInt16LE(32767, i * 2);
    const rms = rms01FromS16leMonoFrame(buf, samples);
    expect(rms).toBeGreaterThan(0.99);
  });
});
