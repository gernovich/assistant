import type { AssistantSettings } from "../../types";
import { err, ok, type Result } from "../../shared/result";
import { APP_ERROR } from "../../shared/appErrorCodes";

type Logger = {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

export type SettingsUseCaseDeps = {
  log: Logger;
  getSettingsSummaryForLog: (settings: AssistantSettings) => Record<string, unknown>;

  saveData: (settings: AssistantSettings) => Promise<void>;
  applyCoreSettings: (settings: AssistantSettings) => Promise<void>;

  ensureVaultStructure: (settings: AssistantSettings) => Promise<void>;
  updateOpenViews: (settings: AssistantSettings) => void;
  rescheduleNotifications: () => void;

  setupAutoRefreshTimer: () => void;
  updateRibbonIcons: () => void;
  applyRecordingMediaPermissions: () => void;
};

export class SettingsUseCase {
  constructor(private readonly deps: SettingsUseCaseDeps) {}

  async saveAndApplyResult(settings: AssistantSettings): Promise<Result<void>> {
    const summary = this.deps.getSettingsSummaryForLog(settings);
    this.deps.log.info("Настройки: сохранить+применить (start)", { settings: summary });

    try {
      await this.deps.saveData(settings);
      await this.deps.applyCoreSettings(settings);
    } catch (e) {
      const msg = String((e as unknown) ?? "неизвестная ошибка");
      this.deps.log.error("Настройки: сохранить+применить (ошибка)", { error: msg, settings: summary });
      return err({
        code: APP_ERROR.SETTINGS,
        message: "Не удалось сохранить/применить настройки",
        cause: msg,
      });
    }

    try {
      await this.deps.ensureVaultStructure(settings);
    } catch (e) {
      void e;
      // Поведение совместимо с прошлым `main.ts`: не ломаем сохранение настроек из-за папок/.base.
      this.deps.log.warn("Не удалось обновить папки/.base (проверьте права vault)");
    }

    this.deps.updateOpenViews(settings);
    this.deps.rescheduleNotifications();

    this.deps.setupAutoRefreshTimer();
    this.deps.updateRibbonIcons();
    this.deps.applyRecordingMediaPermissions();

    this.deps.log.info("Настройки: сохранены и применены (ok)", { settings: this.deps.getSettingsSummaryForLog(settings) });
    return ok(undefined);
  }

  /**
   * Backward-compatible wrapper: не бросаем исключения наружу.
   * Ошибка уже залогирована внутри `saveAndApplyResult`.
   */
  async saveAndApply(settings: AssistantSettings): Promise<void> {
    void (await this.saveAndApplyResult(settings));
  }
}

