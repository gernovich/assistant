import type { AssistantSettings } from "../../types";
import type { LogService } from "../../log/logService";
import { err, ok, type Result } from "../../shared/result";
import { APP_ERROR } from "../../shared/appErrorCodes";

/**
 * Use-case: централизованное обновление settings (mutate + save/apply).
 *
 * Зачем:
 * - UI секции не должны напрямую дергать `saveSettingsAndApply()` и размазывать порядок действий
 * - в одном месте можно позже добавить: validation, audit-log, immutable updates, telemetry и т.п.
 *
 * Сейчас это intentionally "mutable" (mutator изменяет текущий объект settings),
 * чтобы не ломать существующие UI refs (например `cal`/`acc` объекты из массива).
 */
export class UpdateSettingsUseCase {
  constructor(
    private readonly deps: {
      getSettings: () => AssistantSettings;
      saveSettingsAndApply: () => Promise<void>;
      log: LogService;
    },
  ) {}

  async updateResult(mutator: (s: AssistantSettings) => void): Promise<Result<void>> {
    try {
      const s = this.deps.getSettings();
      mutator(s);
      await this.deps.saveSettingsAndApply();
      return ok(undefined);
    } catch (e) {
      this.deps.log.error("Настройки: update: ошибка", { error: e });
      return err({
        code: APP_ERROR.SETTINGS,
        message: "Не удалось сохранить/применить настройки",
        cause: String((e as unknown) ?? "unknown"),
      });
    }
  }

  /**
   * Backward-compatible wrapper: не бросаем исключения наружу.
   * Ошибка уже залогирована внутри `updateResult`.
   */
  async update(mutator: (s: AssistantSettings) => void): Promise<void> {
    void (await this.updateResult(mutator));
  }
}
