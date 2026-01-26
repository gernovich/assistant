import type { AssistantSettings } from "../../types";
import type { LogService } from "../../log/logService";
import { err, ok, type Result } from "../../shared/result";
import { APP_ERROR } from "../../shared/appErrorCodes";

/**
 * Юзкейс: централизованное обновление настроек (мутация + сохранение/применение).
 *
 * Зачем:
 * - секции интерфейса не должны напрямую дергать `saveSettingsAndApply()` и размазывать порядок действий
 * - в одном месте можно позже добавить: валидацию, журнал аудита, неизменяемые обновления, телеметрию и т.п.
 *
 * Сейчас это намеренно "mutable" (функция‑мутатор изменяет текущий объект настроек),
 * чтобы не ломать существующие ссылки интерфейса (например объекты `cal`/`acc` из массива).
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
      this.deps.log.error("Настройки: обновление: ошибка", { error: e });
      return err({
        code: APP_ERROR.SETTINGS,
        message: "Не удалось сохранить/применить настройки",
        cause: String((e as unknown) ?? "неизвестная ошибка"),
      });
    }
  }

  /**
   * Обратная совместимость: не бросаем исключения наружу.
   * Ошибка уже залогирована внутри `updateResult`.
   */
  async update(mutator: (s: AssistantSettings) => void): Promise<void> {
    void (await this.updateResult(mutator));
  }
}
