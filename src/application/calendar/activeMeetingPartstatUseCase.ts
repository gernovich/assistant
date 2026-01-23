import type { Calendar } from "../../types";
import { splitFrontmatter, parseFrontmatterMap } from "../../domain/policies/frontmatter";
import { makeCalendarStub } from "../../domain/policies/calendarStub";

type Logger = {
  warn: (message: string, data?: Record<string, unknown>) => void;
};

export type Partstat = "accepted" | "declined" | "tentative" | "needs_action";

export type ActiveMeetingPartstatUseCaseDeps = {
  getActiveFile: () => { path: string } | null;
  readFileText: (file: { path: string }) => Promise<string>;
  getFrontmatterCache: (file: { path: string }) => Record<string, unknown> | undefined;

  setMyPartstatInCalendar: (params: { calendar: Calendar; id: string; start: Date }, partstat: Partstat) => Promise<void>;

  enqueueOutbox: (item: {
    id: string;
    createdAtMs: number;
    kind: "set_event_partstat";
    payload: { calendarId: string; uid: string; start: string; partstat: Partstat };
  }) => Promise<void>;

  notice: (message: string) => void;
  log: Logger;
  nowMs: () => number;
  randomHex: () => string;
};

export class ActiveMeetingPartstatUseCase {
  constructor(private readonly deps: ActiveMeetingPartstatUseCaseDeps) {}

  async apply(partstat: Partstat): Promise<void> {
    const file = this.deps.getActiveFile();
    if (!file) {
      this.deps.notice("Ассистент: откройте заметку встречи");
      return;
    }

    try {
      const cur = await this.deps.readFileText(file);
      const { frontmatter } = splitFrontmatter(cur);
      const fm = frontmatter ? parseFrontmatterMap(frontmatter) : {};
      if (fm["assistant_type"] !== "calendar_event") {
        this.deps.notice("Ассистент: активный файл — не заметка встречи");
        return;
      }

      const calendarId = String(fm["calendar_id"] ?? "").trim();
      const uid = String(fm["event_id"] ?? "").trim();
      const startRaw = String(fm["start"] ?? "").trim();
      if (!calendarId || !uid || !startRaw) {
        this.deps.notice("Ассистент: не найден calendar_id/event_id/start в frontmatter встречи");
        return;
      }

      const start = new Date(startRaw);
      if (Number.isNaN(start.getTime())) {
        this.deps.notice("Ассистент: неверный формат start в frontmatter встречи");
        return;
      }

      const calendar: Calendar = {
        ...makeCalendarStub({ id: calendarId, name: "" }),
      };

      await this.deps.setMyPartstatInCalendar({ calendar, id: uid, start }, partstat);
      this.deps.notice("Ассистент: статус обновлён в календаре");
    } catch (e) {
      // Если не можем применить сейчас (например нет сети) — кладём в outbox.
      const fm = this.deps.getFrontmatterCache(file);
      const calendarId = String(fm?.calendar_id ?? "").trim();
      const uid = String(fm?.event_id ?? "").trim();
      const start = String(fm?.start ?? "").trim();

      const id = `${this.deps.nowMs().toString(36)}-${this.deps.randomHex()}`;
      await this.deps.enqueueOutbox({
        id,
        createdAtMs: this.deps.nowMs(),
        kind: "set_event_partstat",
        payload: { calendarId, uid, start, partstat },
      });

      this.deps.log.warn("Офлайн-режим: действие добавлено в очередь (не удалось применить к календарю)", {
        calendarId,
        uid,
        start,
        partstat,
        error: String((e as unknown) ?? "неизвестная ошибка"),
      });
      this.deps.notice("Ассистент: не удалось применить. Действие добавлено в офлайн-очередь.");
    }
  }
}

