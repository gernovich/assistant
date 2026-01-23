import { describe, expect, it, vi } from "vitest";
import { CalendarRefreshUseCase } from "../../src/application/calendar/calendarRefreshUseCase";
import { DEFAULT_SETTINGS } from "../../src/settingsStore";

describe("CalendarRefreshUseCase", () => {
  it("refreshAll: при ошибке показывает notice и пишет error", async () => {
    const notice = vi.fn();
    const error = vi.fn();

    const uc = new CalendarRefreshUseCase({
      getSettings: () => structuredClone(DEFAULT_SETTINGS),
      refreshCalendarsAndSync: vi.fn().mockRejectedValue(new Error("boom")),
      refreshOneAndMerge: vi.fn(),
      syncFromCurrentEvents: vi.fn(),
      notice,
      log: { info: vi.fn(), warn: vi.fn(), error },
    });

    await uc.refreshAll();
    expect(notice).toHaveBeenCalledWith("Ассистент: не удалось обновить календари");
    expect(error).toHaveBeenCalledWith("Календарь: refreshAll: ошибка", { code: "E_NETWORK", error: "Error: boom" });
  });

  it("refreshOne: логирует ошибки по календарям, синкает и пишет ok если ошибок нет", async () => {
    const info = vi.fn();
    const warn = vi.fn();

    const uc = new CalendarRefreshUseCase({
      getSettings: () => structuredClone(DEFAULT_SETTINGS),
      refreshCalendarsAndSync: vi.fn(),
      refreshOneAndMerge: vi.fn().mockResolvedValue({
        errors: [{ calendarId: "c1", name: "Cal", error: "net" }],
      }),
      syncFromCurrentEvents: vi.fn().mockResolvedValue(undefined),
      notice: vi.fn(),
      log: { info, warn, error: vi.fn() },
    });

    await uc.refreshOne("c1");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(info).not.toHaveBeenCalled();
  });

  it("refreshOne: ok-path пишет info", async () => {
    const info = vi.fn();
    const uc = new CalendarRefreshUseCase({
      getSettings: () => structuredClone(DEFAULT_SETTINGS),
      refreshCalendarsAndSync: vi.fn(),
      refreshOneAndMerge: vi.fn().mockResolvedValue({ errors: [] }),
      syncFromCurrentEvents: vi.fn().mockResolvedValue(undefined),
      notice: vi.fn(),
      log: { info, warn: vi.fn(), error: vi.fn() },
    });

    await uc.refreshOne("c1");
    expect(info).toHaveBeenCalledWith("Календарь: refreshOne: ok", { calendarId: "c1" });
  });

  it("refreshAllResult: возвращает Result error вместо throw", async () => {
    const uc = new CalendarRefreshUseCase({
      getSettings: () => structuredClone(DEFAULT_SETTINGS),
      refreshCalendarsAndSync: vi.fn().mockRejectedValue(new Error("boom")),
      refreshOneAndMerge: vi.fn(),
      syncFromCurrentEvents: vi.fn(),
      notice: vi.fn(),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const r = await uc.refreshAllResult();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("E_NETWORK");
    expect(r.error.message).toContain("не удалось обновить календари");
  });
});
