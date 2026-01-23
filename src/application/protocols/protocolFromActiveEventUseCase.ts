import type { Calendar, Event } from "../../types";
import { makeCalendarStub } from "../../domain/policies/calendarStub";

export type ProtocolFromActiveEventUseCaseDeps = {
  getActiveFile: () => { path: string; basename: string } | null;
  getFrontmatterCache: (file: { path: string }) => Record<string, unknown> | undefined;
  createProtocolFromEvent: (ev: Event) => Promise<unknown>;
  notice: (message: string) => void;
};

export class ProtocolFromActiveEventUseCase {
  constructor(private readonly deps: ProtocolFromActiveEventUseCaseDeps) {}

  async createFromActiveEvent(): Promise<void> {
    const file = this.deps.getActiveFile();
    if (!file) {
      this.deps.notice("Ассистент: нет активного файла");
      return;
    }

    const fm = this.deps.getFrontmatterCache(file);
    if (!fm || String(fm["assistant_type"] ?? "") !== "calendar_event") {
      this.deps.notice("Ассистент: открой файл встречи (assistant_type: calendar_event)");
      return;
    }

    const calendarId = String(fm["calendar_id"] ?? "");
    const uid = String(fm["event_id"] ?? "");
    const summary = String(fm["summary"] ?? file.basename);
    const startIso = String(fm["start"] ?? "");
    const endIso = String(fm["end"] ?? "");

    if (!calendarId || !uid || !startIso) {
      this.deps.notice("Ассистент: во встрече не хватает calendar_id/event_id/start");
      return;
    }

    const calendar: Calendar = makeCalendarStub({ id: calendarId, name: "" });

    await this.deps.createProtocolFromEvent({
      calendar,
      id: uid,
      summary,
      start: new Date(startIso),
      end: endIso ? new Date(endIso) : undefined,
    });
  }
}

