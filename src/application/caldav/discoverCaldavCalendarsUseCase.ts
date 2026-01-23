import type { LogService } from "../../log/logService";
import { err, ok, type Result } from "../../shared/result";

export class DiscoverCaldavCalendarsUseCase {
  constructor(
    private readonly deps: {
      discoverCalendars: (accountId: string) => Promise<Array<{ displayName: string; url: string; color?: string }>>;
      notice: (msg: string) => void;
      log: LogService;
    },
  ) {}

  async executeResult(accountId: string): Promise<Result<Array<{ displayName: string; url: string; color?: string }>>> {
    const id = String(accountId ?? "").trim();
    if (!id) {
      return err({
        code: "E_VALIDATION",
        message: "Ассистент: CalDAV discovery: accountId пустой",
      });
    }

    try {
      const cals = await this.deps.discoverCalendars(id);
      return ok(cals);
    } catch (e) {
      const raw = String((e as unknown) ?? "неизвестная ошибка");
      const short = raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
      return err({
        code: "E_CALDAV_DISCOVERY",
        message: `Ассистент: CalDAV discovery ошибка: ${short}. Подробности в логе.`,
        cause: raw,
        details: { accountId: id },
      });
    }
  }

  /**
   * Backward-compat API для UI: не бросает исключения.
   * При ошибке пишет в лог/notice и возвращает `[]`.
   */
  async execute(accountId: string): Promise<Array<{ displayName: string; url: string; color?: string }>> {
    const r = await this.executeResult(accountId);
    if (!r.ok) {
      if (r.error.code === "E_CALDAV_DISCOVERY") {
        this.deps.log.error("CalDAV: discovery ошибка", { code: r.error.code, error: r.error.cause, details: r.error.details });
      } else {
        this.deps.log.warn("CalDAV: discovery: validation error", { code: r.error.code, details: r.error.details });
      }
      this.deps.notice(r.error.message);
      return [];
    }
    return r.value;
  }
}

