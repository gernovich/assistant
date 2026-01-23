import { describe, expect, it, vi } from "vitest";
import { ManualMeetingUseCase } from "../../src/application/meetings/manualMeetingUseCase";

describe("ManualMeetingUseCase", () => {
  it("создаёт manual event и открывает meeting", async () => {
    const openEvent = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2020-01-01T10:00:00.000Z");

    const uc = new ManualMeetingUseCase({
      meetings: { openEvent } as any,
      now: () => now,
      nowMs: () => 123,
      randomHex: () => "abc",
    });

    await uc.createAndOpen();
    expect(openEvent).toHaveBeenCalledTimes(1);
    const ev = openEvent.mock.calls[0][0];
    expect(ev.calendar.id).toBe("manual");
    expect(String(ev.id)).toContain("manual-");
  });
});
