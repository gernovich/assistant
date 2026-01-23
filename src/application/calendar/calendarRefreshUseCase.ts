import type { AssistantSettings } from "../../types";
import { err, ok, type Result } from "../../shared/result";

type Logger = {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

export type CalendarRefreshUseCaseDeps = {
  getSettings: () => AssistantSettings;
  refreshCalendarsAndSync: (settings: AssistantSettings) => Promise<void>;
  refreshOneAndMerge: (
    calendarId: string,
  ) => Promise<{ errors: Array<{ calendarId: string; name: string; error: string; cause?: unknown }> }>;
  syncFromCurrentEvents: (settings: AssistantSettings) => Promise<void>;
  notice: (message: string) => void;
  log: Logger;
};

export class CalendarRefreshUseCase {
  constructor(private readonly deps: CalendarRefreshUseCaseDeps) {}

  async refreshAllResult(): Promise<Result<void>> {
    try {
      await this.deps.refreshCalendarsAndSync(this.deps.getSettings());
      return ok(undefined);
    } catch (e) {
      return err({
        code: "E_NETWORK",
        message: "Ассистент: не удалось обновить календари",
        cause: String((e as unknown) ?? "неизвестная ошибка"),
      });
    }
  }

  async refreshAll(): Promise<void> {
    const r = await this.refreshAllResult();
    if (!r.ok) {
      this.deps.notice(r.error.message);
      this.deps.log.error("Календарь: refreshAll: ошибка", { code: r.error.code, error: r.error.cause });
    }
  }

  async refreshOneResult(
    calendarId: string,
  ): Promise<Result<{ errors: Array<{ calendarId: string; name: string; error: string; cause?: unknown }> }>> {
    try {
      const settings = this.deps.getSettings();
      const { errors } = await this.deps.refreshOneAndMerge(calendarId);
      await this.deps.syncFromCurrentEvents(settings);
      return ok({ errors });
    } catch (e) {
      return err({
        code: "E_NETWORK",
        message: "Ассистент: не удалось обновить календарь",
        cause: String((e as unknown) ?? "неизвестная ошибка"),
        details: { calendarId },
      });
    }
  }

  async refreshOne(calendarId: string): Promise<void> {
    const r = await this.refreshOneResult(calendarId);
    if (!r.ok) {
      this.deps.notice(r.error.message);
      this.deps.log.error("Календарь: refreshOne: ошибка", { code: r.error.code, error: r.error.cause, calendarId });
      return;
    }

    for (const e of r.value.errors) {
      this.deps.log.warn("Календарь: refreshOne: ошибка", { calendarId: e.calendarId, name: e.name, error: e.error, cause: e.cause });
    }
    if (r.value.errors.length === 0) this.deps.log.info("Календарь: refreshOne: ok", { calendarId });
  }
}
