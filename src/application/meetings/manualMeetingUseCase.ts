import type { Calendar, Event } from "../../types";
import type { MeetingNoteRepository } from "../contracts/meetingNoteRepository";
import { makeCalendarStub } from "../../domain/policies/calendarStub";
import { err, ok, type Result } from "../../shared/result";
import { APP_ERROR } from "../../shared/appErrorCodes";

export type ManualMeetingUseCaseDeps = {
  meetings: MeetingNoteRepository;
  now: () => Date;
  nowMs: () => number;
  randomHex: () => string;
};

export class ManualMeetingUseCase {
  constructor(private readonly deps: ManualMeetingUseCaseDeps) {}

  async createAndOpenResult(): Promise<Result<void>> {
    try {
      await this.createAndOpen();
      return ok(undefined);
    } catch (e) {
      const msg = String((e as unknown) ?? "неизвестная ошибка");
      return err({ code: APP_ERROR.VAULT_IO, message: "Не удалось создать/открыть карточку встречи", cause: msg });
    }
  }

  async createAndOpen(): Promise<void> {
    const now = this.deps.now();
    const uid = `manual-${this.deps.nowMs().toString(36)}-${this.deps.randomHex()}`;
    const summary = `Встреча ${now.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })}`;

    const calendar: Calendar = makeCalendarStub({ id: "manual", name: "Manual" });

    const ev: Event = {
      calendar,
      id: uid,
      summary,
      start: now,
      end: new Date(now.getTime() + 60 * 60_000),
    };

    await this.deps.meetings.openEvent(ev);
  }
}

