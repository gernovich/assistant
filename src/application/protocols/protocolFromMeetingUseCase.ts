import type { Event } from "../../types";
import type { MeetingNoteRepository } from "../contracts/meetingNoteRepository";
import type { ProtocolNoteRepository } from "../contracts/protocolNoteRepository";
import { parseMeetingNoteFromMd } from "../../domain/policies/frontmatterDtos";
import { makeCalendarStub } from "../../domain/policies/calendarStub";
import type { VaultFileLike } from "../../shared/vaultFileLike";

type Logger = {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
};

export type ProtocolFromMeetingUseCaseDeps = {
  getActiveFile: () => VaultFileLike | null;
  readFileText: (file: VaultFileLike) => Promise<string>;
  meetingNotes: MeetingNoteRepository;
  protocols: ProtocolNoteRepository;
  notice: (message: string) => void;
  log: Logger;
};

export class ProtocolFromMeetingUseCase {
  constructor(private readonly deps: ProtocolFromMeetingUseCaseDeps) {}

  async createFromActiveMeeting(): Promise<void> {
    const file = this.deps.getActiveFile();
    if (!file) {
      this.deps.notice("Ассистент: откройте карточку встречи");
      return;
    }

    try {
      const protocol = await this.deps.protocols.createProtocolFromMeetingFile(file);
      await this.deps.protocols.openProtocol(protocol);

      // Связь протокол ↔ встреча (если у заметки есть event_id).
      const text = await this.deps.readFileText(file);
      const mr = parseMeetingNoteFromMd(text, { fileBasename: file.basename });
      if (!mr.ok) {
        // Не ломаем создание протокола: просто не создаём связь, но логируем.
        this.deps.log.warn("Протокол: не удалось распарсить карточку встречи (frontmatter)", { code: mr.error.code, error: mr.error.message });
        return;
      }
      const m = mr.value;
      const calendarId = String(m.calendar_id ?? "manual");
      const eventId = String(m.event_id ?? "").trim();
      if (eventId) {
        const ev: Event = {
          calendar: makeCalendarStub({ id: calendarId, name: "" }),
          id: eventId,
          summary: String(m.summary ?? file.basename ?? "Встреча"),
          start: m.start ? new Date(String(m.start)) : new Date(),
          end: m.end ? new Date(String(m.end)) : undefined,
        };
        await this.deps.meetingNotes.linkProtocol(ev, protocol);
      }

      this.deps.log.info("Создан протокол из открытой карточки встречи", { protocol: protocol.path, meeting: file.path });
    } catch (e) {
      const msg = String((e as unknown) ?? "неизвестная ошибка");
      this.deps.log.warn("Не удалось создать протокол из карточки встречи", { error: msg });
      this.deps.notice(`Ассистент: не удалось создать протокол: ${msg}`);
    }
  }
}

