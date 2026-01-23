import type { Calendar } from "../../types";
import type { OutboxItemV1 } from "../../offline/outboxService";
import { makeCalendarStub } from "../../domain/policies/calendarStub";
import { err, ok, type AppErrorDto, type Result } from "../../shared/result";
import { APP_ERROR } from "../../shared/appErrorCodes";

type Logger = {
  warn: (message: string, data?: Record<string, unknown>) => void;
};

export type OutboxApplyUseCaseDeps = {
  list: () => Promise<OutboxItemV1[]>;
  replace: (items: OutboxItemV1[]) => Promise<void>;
  setMyPartstatInCalendar: (params: { calendar: Calendar; id: string; start: Date }, partstat: string) => Promise<void>;
  notice: (message: string) => void;
  log: Logger;
};

export class OutboxApplyUseCase {
  constructor(private readonly deps: OutboxApplyUseCaseDeps) {}

  async executeResult(): Promise<
    Result<{
      applied: number;
      remaining: number;
      errors: Array<{ id: string; error: AppErrorDto }>;
    }>
  > {
    let items: OutboxItemV1[];
    try {
      items = await this.deps.list();
    } catch (e) {
      return err({ code: APP_ERROR.OUTBOX, message: "Не удалось прочитать офлайн-очередь", cause: String(e) });
    }

    if (!items.length) {
      return ok({ applied: 0, remaining: 0, errors: [] });
    }

    const remaining: OutboxItemV1[] = [];
    const errors: Array<{ id: string; error: AppErrorDto }> = [];
    let applied = 0;

    for (const it of items) {
      if (it.kind !== "set_event_partstat") {
        remaining.push(it);
        continue;
      }

      const calendarId = String(it.payload?.calendarId ?? "");
      const uid = String(it.payload?.uid ?? it.payload?.id ?? "");
      const startIso = String(it.payload?.start ?? "");
      const partstat = String(it.payload?.partstat ?? "");

      if (!calendarId || !uid || !startIso) {
        remaining.push(it);
        errors.push({
          id: it.id,
          error: { code: APP_ERROR.VALIDATION, message: "Outbox payload некорректен", details: { calendarId, uid, startIso } },
        });
        continue;
      }

      try {
        const d = new Date(startIso);
        if (Number.isNaN(d.getTime())) {
          remaining.push(it);
          errors.push({
            id: it.id,
            error: { code: APP_ERROR.VALIDATION, message: "Outbox payload: invalid start", details: { startIso } },
          });
          continue;
        }
        if (partstat !== "accepted" && partstat !== "declined" && partstat !== "tentative" && partstat !== "needs_action") {
          remaining.push(it);
          errors.push({
            id: it.id,
            error: { code: APP_ERROR.VALIDATION, message: "Outbox payload: invalid partstat", details: { partstat } },
          });
          continue;
        }

        const calendar: Calendar = makeCalendarStub({ id: calendarId, name: "" });
        await this.deps.setMyPartstatInCalendar({ calendar, id: uid, start: d }, partstat);
        applied++;
      } catch (e) {
        const msg = String((e as unknown) ?? "неизвестная ошибка");
        this.deps.log.warn("Outbox: не удалось применить действие", { id: it.id, error: msg });
        remaining.push(it);
        errors.push({
          id: it.id,
          error: { code: APP_ERROR.CALDAV_WRITEBACK, message: "Не удалось применить действие outbox", cause: msg },
        });
      }
    }

    try {
      await this.deps.replace(remaining);
    } catch (e) {
      return err({ code: APP_ERROR.OUTBOX, message: "Не удалось сохранить офлайн-очередь", cause: String(e) });
    }

    return ok({ applied, remaining: remaining.length, errors });
  }

  async applyAll(): Promise<{ applied: number; remaining: number }> {
    const r = await this.executeResult();
    if (!r.ok) {
      this.deps.notice("Ассистент: не удалось применить офлайн-очередь (подробности в логе)");
      this.deps.log.warn("Outbox: applyAll failed", { code: r.error.code, error: r.error.cause });
      return { applied: 0, remaining: 0 };
    }
    if (r.value.applied === 0 && r.value.remaining === 0) {
      this.deps.notice("Ассистент: очередь пуста");
      return { applied: 0, remaining: 0 };
    }
    this.deps.notice(`Ассистент: применено действий: ${r.value.applied}, осталось: ${r.value.remaining}`);
    return { applied: r.value.applied, remaining: r.value.remaining };
  }
}

