import type { AssistantSettings, Event } from "../../types";
import { err, ok, type Result } from "../../shared/result";
import { hasMyAttendeePolicy, myEmailsForEventPolicy } from "../../domain/policies/rsvpEligibility";
import { toAppErrorDto } from "../../shared/appError";
import { APP_ERROR } from "../../shared/appErrorCodes";

type Logger = {
  error: (message: string, data?: Record<string, unknown>) => void;
};

export type RsvpUseCaseDeps = {
  getSettings: () => AssistantSettings;
  setMyPartstatInCalendar: (ev: Event, partstat: NonNullable<Event["status"]>) => Promise<void>;
  notice: (message: string) => void;
  log: Logger;
};

export class RsvpUseCase {
  constructor(private readonly deps: RsvpUseCaseDeps) {}

  async setMyPartstat(ev: Event, partstat: NonNullable<Event["status"]>): Promise<Result<void>> {
    const settings = this.deps.getSettings();
    const myEmails = myEmailsForEventPolicy(settings, ev);

    if (!myEmails.length) {
      this.deps.notice("Ассистент: невозможно определить мой email для RSVP (проверьте myEmail/логин CalDAV)");
      return err({ code: "E_VALIDATION", message: "Не удалось определить мой email для RSVP" });
    }

    if (!hasMyAttendeePolicy(ev, myEmails)) {
      this.deps.notice("Ассистент: RSVP недоступен — ваш email не найден среди ATTENDEE этой встречи");
      return err({ code: "E_VALIDATION", message: "RSVP недоступен: email не найден среди ATTENDEE" });
    }

    try {
      await this.deps.setMyPartstatInCalendar(ev, partstat);
      return ok(undefined);
    } catch (e) {
      const dto = toAppErrorDto(e, { code: APP_ERROR.CALDAV_WRITEBACK, message: "Ассистент: не удалось изменить статус в календаре" });
      this.deps.notice(dto.message);
      this.deps.log.error("RSVP: установка статуса: ошибка", {
        code: dto.code,
        error: e,
        cause: dto.cause,
        calendarId: ev.calendar.id,
        eventId: ev.id,
        startIso: ev.start?.toISOString?.() ?? "",
        partstat,
      });
      return err({ code: dto.code, message: dto.message, cause: dto.cause, details: dto.details });
    }
  }
}
