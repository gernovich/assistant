import { describe, expect, it, vi } from "vitest";
import { RecordingVizNormalizer } from "../../src/recording/recordingVizNormalizer";
import { chainVizNormalizerSteps, createSilenceFloorStep } from "../../src/domain/policies/recordingVizNormalizePolicy";

describe("RecordingVizNormalizer", () => {
  const identity = (r: number) => r;

  it("выдаёт значения по интервалу и снижает при отсутствии событий", () => {
    const n = new RecordingVizNormalizer({ normalizePolicy: identity, outputIntervalMs: 100, decayFactor: 0.9 });
    n.push(1, 0);

    expect(n.pull(0)).toBe(1);
    expect(n.pull(50)).toBeNull();
    expect(n.pull(100)).toBeCloseTo(0.9, 6);
    expect(n.pull(200)).toBeCloseTo(0.81, 6);
  });

  it("пропускает сырое значение через политику без пика (identity)", () => {
    const n = new RecordingVizNormalizer({ normalizePolicy: identity, outputIntervalMs: 5 });
    n.push(0.2, 0);
    expect(n.pull(0)).toBeCloseTo(0.2, 6);

    n.push(0.1, 10);
    expect(n.pull(10)).toBeCloseTo(0.1, 6);
  });

  it("глушит тишину по порогу через политику", () => {
    const policy = chainVizNormalizerSteps([createSilenceFloorStep(0.05)]);
    const n = new RecordingVizNormalizer({ normalizePolicy: policy, outputIntervalMs: 5 });
    n.push(0.02, 0);
    expect(n.pull(0)).toBe(0);

    n.push(0.2, 10);
    expect(n.pull(10)).toBeCloseTo(0.2, 6);

    n.push(0.01, 20);
    expect(n.pull(20)).toBe(0);
  });

  it("нулевой вход даёт нулевое значение", () => {
    const n = new RecordingVizNormalizer({ normalizePolicy: identity, outputIntervalMs: 5 });
    n.push(1, 0);
    expect(n.pull(0)).toBe(1);

    n.push(0, 5);
    expect(n.pull(5)).toBe(0);
  });

  it("логирует агрегированную статистику по интервалу", () => {
    const onLog = vi.fn();
    const n = new RecordingVizNormalizer({
      normalizePolicy: identity,
      outputIntervalMs: 50,
      logIntervalMs: 100,
      onLog,
    });
    n.push(0.5, 0);
    n.pull(0);
    n.pull(50);
    n.pull(100);

    expect(onLog).toHaveBeenCalledTimes(1);
    const msg = String(onLog.mock.calls[0]?.[0] ?? "");
    expect(msg).toContain("вход=1");
    expect(msg).toContain("выход=3");
  });

  it("pause/resume сбрасывает хвост и отдаёт 0 до нового входа", () => {
    const n = new RecordingVizNormalizer({ normalizePolicy: identity, outputIntervalMs: 10 });
    n.push(1, 0);
    expect(n.pull(0)).toBe(1);

    n.pause(100);
    expect(n.pull(100)).toBeNull();
    expect(n.pull(110)).toBe(0);

    n.resume(200);
    expect(n.pull(200)).toBeNull();
    expect(n.pull(210)).toBe(0);

    n.push(0.5, 215);
    expect(n.pull(220)).toBeCloseTo(0.5, 6);
  });
});
