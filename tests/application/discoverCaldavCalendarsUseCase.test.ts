import { describe, expect, it, vi } from "vitest";
import { DiscoverCaldavCalendarsUseCase } from "../../src/application/caldav/discoverCaldavCalendarsUseCase";

describe("DiscoverCaldavCalendarsUseCase", () => {
  it("executeResult: ok", async () => {
    const discoverCalendars = vi.fn().mockResolvedValue([{ displayName: "Primary", url: "u" }]);
    const notice = vi.fn();
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

    const uc = new DiscoverCaldavCalendarsUseCase({ discoverCalendars, notice, log });
    const r = await uc.executeResult("acc1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([{ displayName: "Primary", url: "u" }]);
  });

  it("executeResult: catch -> Result error (no throw)", async () => {
    const discoverCalendars = vi.fn().mockRejectedValue(new Error("boom"));
    const notice = vi.fn();
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

    const uc = new DiscoverCaldavCalendarsUseCase({ discoverCalendars, notice, log });
    const r = await uc.executeResult("acc1");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("E_CALDAV_DISCOVERY");
      expect(String(r.error.cause)).toContain("boom");
    }
  });

  it("execute: on discovery error -> notice + log.error + returns []", async () => {
    const discoverCalendars = vi.fn().mockRejectedValue(new Error("boom"));
    const notice = vi.fn();
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

    const uc = new DiscoverCaldavCalendarsUseCase({ discoverCalendars, notice, log });
    await expect(uc.execute("acc1")).resolves.toEqual([]);
    expect(notice).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});

