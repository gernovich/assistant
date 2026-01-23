import type { Calendar, Event } from "../../types";
import type { AssistantSettings } from "../../types";
import type { OutboxService } from "../../offline/outboxService";
import type { CalendarService } from "../../calendar/calendarService";
import type { SyncService } from "../../sync/syncService";
import { splitFrontmatter } from "../../domain/policies/frontmatter";
import { parseFrontmatterMap } from "../../domain/policies/frontmatter";
import { makeEventKey } from "../../ids/stableIds";
import { hasMyAttendeePolicy, myEmailsForEventPolicy } from "../../domain/policies/rsvpEligibility";
import { makeCalendarStub } from "../../domain/policies/calendarStub";
import { err, ok, type Result } from "../../shared/result";
import { APP_ERROR } from "../../shared/appErrorCodes";

type Logger = {
  warn: (message: string, data?: Record<string, unknown>) => void;
};

export type MeetingStatusWritebackUseCaseDeps = {
  getSettings: () => AssistantSettings;
  readMeetingFileText: (file: { path: string }) => Promise<string>;
  calendarService: Pick<CalendarService, "getEventByEventKey" | "setMyPartstat">;
  syncService: Pick<SyncService, "syncFromCurrentEvents">;
  outbox: Pick<OutboxService, "enqueue">;
  notice: (message: string) => void;
  log: Logger;
  nowMs: () => number;
  randomHex: () => string;
};

export class MeetingStatusWritebackUseCase {
  private recentlyAppliedByEventKey = new Map<string, { status: string; atMs: number }>();

  constructor(private readonly deps: MeetingStatusWritebackUseCaseDeps) {}

  async applyFromMeetingFileResult(
    file: { path: string },
    opts: { silent: boolean },
  ): Promise<Result<{ outcome: "skipped" | "applied" | "enqueued" }>> {
    let cur = "";
    try {
      cur = await this.deps.readMeetingFileText(file);
      const { frontmatter } = splitFrontmatter(cur);
      const fm = frontmatter ? parseFrontmatterMap(frontmatter) : {};
      if (fm["assistant_type"] !== "calendar_event") return ok({ outcome: "skipped" });

      const calendarId = String(fm["calendar_id"] ?? "").trim();
      const eventId = String(fm["event_id"] ?? "").trim();
      const startRaw = String(fm["start"] ?? "").trim();
      const statusRaw = String(fm["status"] ?? "").trim();

      if (!calendarId || !eventId || !startRaw) {
        if (!opts.silent) this.deps.notice("Ассистент: не найден calendar_id/event_id/start в frontmatter встречи");
        return err({ code: APP_ERROR.VALIDATION, message: "Не найден calendar_id/event_id/start в frontmatter встречи" });
      }
      if (!statusRaw) {
        if (!opts.silent) this.deps.notice("Ассистент: в заметке встречи не задан status");
        return err({ code: APP_ERROR.VALIDATION, message: "В заметке встречи не задан status" });
      }
      if (statusRaw !== "accepted" && statusRaw !== "declined" && statusRaw !== "tentative" && statusRaw !== "needs_action") {
        if (!opts.silent) this.deps.notice("Ассистент: неверный status (ожидали accepted/declined/tentative/needs_action)");
        return err({ code: APP_ERROR.VALIDATION, message: "Неверный status" });
      }
      const status: NonNullable<Event["status"]> = statusRaw;

      const start = new Date(startRaw);
      if (Number.isNaN(start.getTime())) {
        if (!opts.silent) this.deps.notice("Ассистент: неверный формат start в заметке встречи");
        return err({ code: APP_ERROR.VALIDATION, message: "Неверный формат start в заметке встречи" });
      }

      const settings = this.deps.getSettings();
      const key = makeEventKey(calendarId, eventId);

      const storeEv = this.deps.calendarService.getEventByEventKey(key);
      if (storeEv) {
        const myEmails = myEmailsForEventPolicy(settings, storeEv);
        if (myEmails.length && !hasMyAttendeePolicy(storeEv, myEmails)) {
          if (!opts.silent) this.deps.notice("Ассистент: RSVP недоступен — ваш email не найден среди ATTENDEE этой встречи");
          return err({ code: APP_ERROR.VALIDATION, message: "RSVP недоступен: email не найден среди ATTENDEE" });
        }
      }

      const cached = this.recentlyAppliedByEventKey.get(key);
      const now = this.deps.nowMs();
      if (cached && cached.status === status && now - cached.atMs < 5_000) return ok({ outcome: "skipped" });

      const inStore = this.deps.calendarService.getEventByEventKey(key);
      if (inStore && inStore.status === status) return ok({ outcome: "skipped" });

      const calendar: Calendar = makeCalendarStub({ id: calendarId, name: "" });
      const ev: Event = { calendar, id: eventId, summary: "", start };
      await this.deps.calendarService.setMyPartstat(ev, status);
      await this.deps.syncService.syncFromCurrentEvents(settings);
      this.recentlyAppliedByEventKey.set(key, { status, atMs: now });

      if (!opts.silent) this.deps.notice("Ассистент: статус применён в календарь и синхронизирован");
      return ok({ outcome: "applied" });
    } catch (e) {
      const msg = String((e as unknown) ?? "неизвестная ошибка");
      if (opts.silent) {
        this.deps.log.warn("RSVP: apply status from meeting note: ошибка", { error: e, message: msg, file: file.path });
        return err({ code: APP_ERROR.CALDAV_WRITEBACK, message: "Не удалось применить status из заметки встречи", cause: msg });
      }

      // Если не можем применить сейчас (например нет сети) — кладём в outbox.
      try {
        const { frontmatter } = splitFrontmatter(cur || (await this.deps.readMeetingFileText(file)));
        const fm = frontmatter ? parseFrontmatterMap(frontmatter) : {};
        const calendarId = String(fm["calendar_id"] ?? "").trim();
        const uid = String(fm["event_id"] ?? "").trim();
        const start = String(fm["start"] ?? "").trim();
        const partstat = String(fm["status"] ?? "").trim();

        const id = `${this.deps.nowMs().toString(36)}-${this.deps.randomHex()}`;
        await this.deps.outbox.enqueue({
          id,
          createdAtMs: this.deps.nowMs(),
          kind: "set_event_partstat",
          payload: { calendarId, uid, start, partstat },
        });
        this.deps.log.warn("Outbox: enqueue from meeting note status (offline)", {
          calendarId,
          uid,
          start,
          partstat,
          error: e,
          message: msg,
        });
        this.deps.notice("Ассистент: не удалось применить. Действие добавлено в офлайн-очередь.");
        return ok({ outcome: "enqueued" });
      } catch (e2) {
        const msg2 = String((e2 as unknown) ?? "неизвестная ошибка");
        this.deps.log.warn("Outbox: enqueue from meeting note status: ошибка", {
          error: e,
          message: msg,
          enqueueError: e2,
          enqueueMessage: msg2,
          file: file.path,
        });
        this.deps.notice(`Ассистент: не удалось применить статус: ${msg}`);
        return err({ code: APP_ERROR.OUTBOX, message: "Не удалось положить действие в офлайн-очередь", cause: msg2 });
      }
    }
  }

  async applyFromMeetingFile(file: { path: string }, opts: { silent: boolean }): Promise<void> {
    await this.applyFromMeetingFileResult(file, opts);
  }
}
