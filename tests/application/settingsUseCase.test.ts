import { describe, expect, it } from "vitest";
import type { AssistantSettings } from "../../src/types";
import { SettingsUseCase } from "../../src/application/settings/settingsUseCase";
import { DEFAULT_SETTINGS } from "../../src/settingsStore";

function makeSettings(): AssistantSettings {
  return structuredClone(DEFAULT_SETTINGS);
}

describe("SettingsUseCase", () => {
  it("вызывает save/apply/ensure/view/notifications/timers/icons/permissions в ожидаемом порядке", async () => {
    const calls: string[] = [];
    const s = makeSettings();

    const uc = new SettingsUseCase({
      log: {
        info: (m) => calls.push(`info:${m}`),
        warn: (m) => calls.push(`warn:${m}`),
        error: (m) => calls.push(`error:${m}`),
      },
      getSettingsSummaryForLog: () => ({}),
      saveData: async () => {
        calls.push("saveData");
      },
      applyCoreSettings: async () => {
        calls.push("applyCoreSettings");
      },
      ensureVaultStructure: async () => {
        calls.push("ensureVaultStructure");
      },
      updateOpenViews: () => calls.push("updateOpenViews"),
      rescheduleNotifications: () => calls.push("rescheduleNotifications"),
      setupAutoRefreshTimer: () => calls.push("setupAutoRefreshTimer"),
      setupTranscriptionTimer: () => calls.push("setupTranscriptionTimer"),
      updateRibbonIcons: () => calls.push("updateRibbonIcons"),
      applyRecordingMediaPermissions: () => calls.push("applyRecordingMediaPermissions"),
    });

    await uc.saveAndApply(s);

    // Важно: сохраняем порядок “ядро” → ensure → UI/планирование → таймеры/иконки/права.
    expect(calls).toEqual([
      "info:Настройки: сохранить+применить (старт)",
      "saveData",
      "applyCoreSettings",
      "ensureVaultStructure",
      "updateOpenViews",
      "rescheduleNotifications",
      "setupAutoRefreshTimer",
      "setupTranscriptionTimer",
      "updateRibbonIcons",
      "applyRecordingMediaPermissions",
      "info:Настройки: сохранены и применены (успех)",
    ]);
  });

  it("если ensureVaultStructure падает — логируем warn и продолжаем", async () => {
    const calls: string[] = [];
    const s = makeSettings();

    const uc = new SettingsUseCase({
      log: {
        info: (m) => calls.push(`info:${m}`),
        warn: (m) => calls.push(`warn:${m}`),
        error: (m) => calls.push(`error:${m}`),
      },
      getSettingsSummaryForLog: () => ({}),
      saveData: async () => {
        calls.push("saveData");
      },
      applyCoreSettings: async () => {
        calls.push("applyCoreSettings");
      },
      ensureVaultStructure: async () => {
        calls.push("ensureVaultStructure");
        throw new Error("nope");
      },
      updateOpenViews: () => calls.push("updateOpenViews"),
      rescheduleNotifications: () => calls.push("rescheduleNotifications"),
      setupAutoRefreshTimer: () => calls.push("setupAutoRefreshTimer"),
      setupTranscriptionTimer: () => calls.push("setupTranscriptionTimer"),
      updateRibbonIcons: () => calls.push("updateRibbonIcons"),
      applyRecordingMediaPermissions: () => calls.push("applyRecordingMediaPermissions"),
    });

    await uc.saveAndApply(s);

    expect(calls).toContain("warn:Не удалось обновить папки/.base (проверьте права хранилища)");
    expect(calls).toContain("updateOpenViews");
    expect(calls).toContain("rescheduleNotifications");
  });

  it("если saveData падает — логируем error и пробрасываем исключение, не вызывая остальные шаги", async () => {
    const s = makeSettings();
    const calls: string[] = [];

    const uc = new SettingsUseCase({
      log: {
        info: (m) => calls.push(`info:${m}`),
        warn: (m) => calls.push(`warn:${m}`),
        error: (m) => calls.push(`error:${m}`),
      },
      getSettingsSummaryForLog: () => ({}),
      saveData: async () => {
        calls.push("saveData");
        throw new Error("db down");
      },
      applyCoreSettings: async () => {
        calls.push("applyCoreSettings");
      },
      ensureVaultStructure: async () => {
        calls.push("ensureVaultStructure");
      },
      updateOpenViews: () => calls.push("updateOpenViews"),
      rescheduleNotifications: () => calls.push("rescheduleNotifications"),
      setupAutoRefreshTimer: () => calls.push("setupAutoRefreshTimer"),
      setupTranscriptionTimer: () => calls.push("setupTranscriptionTimer"),
      updateRibbonIcons: () => calls.push("updateRibbonIcons"),
      applyRecordingMediaPermissions: () => calls.push("applyRecordingMediaPermissions"),
    });

    const r = await uc.saveAndApplyResult(s);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected err");
    expect(r.error.code).toBe("E_SETTINGS");
    expect(r.error.cause).toContain("db down");

    expect(calls).toEqual(["info:Настройки: сохранить+применить (старт)", "saveData", "error:Настройки: сохранить+применить (ошибка)"]);
  });
});
