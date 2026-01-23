import { describe, expect, it, vi } from "vitest";
import { UpdateSettingsUseCase } from "../../src/application/settings/updateSettingsUseCase";
import { DEFAULT_SETTINGS } from "../../src/settingsStore";

describe("UpdateSettingsUseCase", () => {
  it("updateResult возвращает err (E_SETTINGS), если saveSettingsAndApply бросает, и не throw наружу", async () => {
    const saveSettingsAndApply = vi.fn(async () => {
      throw new Error("disk full");
    });
    const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() } as any;
    const getSettings = () => structuredClone(DEFAULT_SETTINGS) as any;

    const uc = new UpdateSettingsUseCase({ getSettings, saveSettingsAndApply, log });
    const r = await uc.updateResult((s) => {
      s.debug.enabled = true;
    });

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected err");
    expect(r.error.code).toBe("E_SETTINGS");
    expect(String(r.error.cause)).toContain("disk full");
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it("update() не бросает исключения наружу (backward-compatible wrapper)", async () => {
    const saveSettingsAndApply = vi.fn(async () => {
      throw new Error("boom");
    });
    const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() } as any;
    const getSettings = () => structuredClone(DEFAULT_SETTINGS) as any;

    const uc = new UpdateSettingsUseCase({ getSettings, saveSettingsAndApply, log });
    await expect(
      uc.update((s) => {
        s.debug.enabled = true;
      }),
    ).resolves.toBeUndefined();
  });
});

