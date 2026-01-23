import { describe, expect, it, vi } from "vitest";
import { AutoRefreshUseCase } from "../../src/application/calendar/autoRefreshUseCase";
import { DEFAULT_SETTINGS } from "../../src/settingsStore";

describe("AutoRefreshUseCase", () => {
  it("если выключено — логирует и не ставит интервал", () => {
    const info = vi.fn();
    const refresh = vi.fn(async () => undefined);
    const setIntervalSpy = vi.fn(globalThis.setInterval);
    const clearIntervalSpy = vi.fn(globalThis.clearInterval);

    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.calendar.autoRefreshEnabled = false;

    const uc = new AutoRefreshUseCase({
      getSettings: () => settings,
      refreshCalendars: refresh,
      setInterval: setIntervalSpy,
      clearInterval: clearIntervalSpy,
      log: { info },
    });

    uc.setup();
    expect(info).toHaveBeenCalledWith("Автообновление: выключено");
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("если включено — ставит интервал и вызывает refresh по таймеру", async () => {
    vi.useFakeTimers();
    const info = vi.fn();
    const refresh = vi.fn(async () => undefined);

    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.calendar.autoRefreshEnabled = true;
    settings.calendar.autoRefreshMinutes = 2;

    const uc = new AutoRefreshUseCase({
      getSettings: () => settings,
      refreshCalendars: refresh,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
      log: { info },
    });

    uc.setup();
    expect(info).toHaveBeenCalledWith("Автообновление: включено", { minutes: 2 });

    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("minutes < 1 => нормализует до 1", () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => undefined);

    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.calendar.autoRefreshEnabled = true;
    settings.calendar.autoRefreshMinutes = 0;

    const setIntervalSpy = vi.fn(globalThis.setInterval);

    const uc = new AutoRefreshUseCase({
      getSettings: () => settings,
      refreshCalendars: refresh,
      setInterval: setIntervalSpy,
      clearInterval: globalThis.clearInterval,
      log: { info: vi.fn() },
    });

    uc.setup();
    expect(setIntervalSpy).toHaveBeenCalled();
    const ms = setIntervalSpy.mock.calls[0]?.[1];
    expect(ms).toBe(60_000);

    vi.useRealTimers();
  });
});
