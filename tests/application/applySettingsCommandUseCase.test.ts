import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/settingsStore";
import { LogService } from "../../src/log/logService";
import { UpdateSettingsUseCase } from "../../src/application/settings/updateSettingsUseCase";
import { ApplySettingsCommandUseCase } from "../../src/application/settings/applySettingsCommandUseCase";

describe("ApplySettingsCommandUseCase", () => {
  it("caldav.account.remove: выключает связанные caldav-календари", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.caldav.accounts = [{ id: "acc1", name: "A", enabled: true, serverUrl: "", username: "", password: "", authMethod: "basic" }];
    settings.calendars = [
      {
        id: "cal1",
        name: "C1",
        type: "caldav",
        enabled: true,
        caldav: { accountId: "acc1", calendarUrl: "u" },
      },
      { id: "cal2", name: "C2", type: "ics_url", enabled: true, url: "x" },
    ];

    const save = vi.fn(async () => {});
    const updateSettings = new UpdateSettingsUseCase({
      getSettings: () => settings,
      saveSettingsAndApply: save,
      log: new LogService(200),
    });
    const uc = new ApplySettingsCommandUseCase({
      updateSettings,
      nowMs: () => 123,
      randomHex: () => "ab",
    });

    await uc.execute({ type: "caldav.account.remove", accountId: "acc1" });

    expect(settings.caldav.accounts).toHaveLength(0);
    expect(settings.calendars[0].enabled).toBe(false);
    expect(settings.calendars[1].enabled).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("calendar.update: переключение типа ics_url <-> caldav поддерживает поля", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.calendars = [{ id: "cal1", name: "C", type: "ics_url", enabled: true, url: "http://x" }];

    const save = vi.fn(async () => {});
    const updateSettings = new UpdateSettingsUseCase({
      getSettings: () => settings,
      saveSettingsAndApply: save,
      log: new LogService(200),
    });
    const uc = new ApplySettingsCommandUseCase({ updateSettings, nowMs: () => 1, randomHex: () => "1" });

    await uc.execute({ type: "calendar.update", calendarId: "cal1", patch: { type: "caldav" } });
    expect(settings.calendars[0].type).toBe("caldav");
    expect(settings.calendars[0].url).toBeUndefined();
    expect(settings.calendars[0].caldav).toEqual({ accountId: "", calendarUrl: "" });

    await uc.execute({ type: "calendar.update", calendarId: "cal1", patch: { type: "ics_url" } });
    expect(settings.calendars[0].type).toBe("ics_url");
    expect(settings.calendars[0].caldav).toBeUndefined();
    expect(settings.calendars[0].url).toBe("");
  });

  it("calendar.add.caldav: добавляет caldav календарь с id", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.calendars = [];

    const save = vi.fn(async () => {});
    const updateSettings = new UpdateSettingsUseCase({
      getSettings: () => settings,
      saveSettingsAndApply: save,
      log: new LogService(200),
    });
    const uc = new ApplySettingsCommandUseCase({ updateSettings, nowMs: () => 123, randomHex: () => "ab" });

    await uc.execute({ type: "calendar.add.caldav", name: "N", accountId: "acc1", calendarUrl: "u", color: "#ff0000" });
    expect(settings.calendars).toHaveLength(1);
    expect(settings.calendars[0].id).toMatch(/^cal-/);
    expect(settings.calendars[0].type).toBe("caldav");
    expect(settings.calendars[0].caldav?.accountId).toBe("acc1");
    expect(settings.calendars[0].caldav?.calendarUrl).toBe("u");
    expect(settings.calendars[0].color).toBe("#ff0000");
  });

  it("folders.update: пустые значения приводятся к дефолтам", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);

    const updateSettings = new UpdateSettingsUseCase({
      getSettings: () => settings,
      saveSettingsAndApply: vi.fn(async () => {}),
      log: new LogService(200),
    });
    const uc = new ApplySettingsCommandUseCase({ updateSettings, nowMs: () => 1, randomHex: () => "1" });

    await uc.execute({ type: "folders.update", patch: { projects: " ", protocols: "" } as any });

    expect(settings.folders.projects).toBe("Ассистент/Проекты");
    expect(settings.folders.protocols).toBe("Ассистент/Протоколы");
  });

  it("recording.update: санитизирует числовые поля", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);

    const updateSettings = new UpdateSettingsUseCase({
      getSettings: () => settings,
      saveSettingsAndApply: vi.fn(async () => {}),
      log: new LogService(200),
    });
    const uc = new ApplySettingsCommandUseCase({ updateSettings, nowMs: () => 1, randomHex: () => "1" });

    await uc.execute({ type: "recording.update", patch: { chunkMinutes: 0, autoStartSeconds: -1 } as any });
    expect(settings.recording.chunkMinutes).toBe(5);
    expect(settings.recording.autoStartSeconds).toBe(5);
  });
});
