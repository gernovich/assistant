import type { PersonRepository } from "../contracts/personRepository";
import { extractEmailsFromTextPolicy } from "../../domain/policies/extractEmails";

type Logger = {
  warn: (message: string, data?: Record<string, unknown>) => void;
};

export type PeopleFromMeetingUseCaseDeps = {
  getActiveFile: () => { path: string } | null;
  getFrontmatterCache: (file: { path: string }) => Record<string, unknown> | undefined;
  readFileText: (file: { path: string }) => Promise<string>;
  people: PersonRepository;
  notice: (message: string) => void;
  log: Logger;
};

export class PeopleFromMeetingUseCase {
  constructor(private readonly deps: PeopleFromMeetingUseCaseDeps) {}

  async createPeopleCardsFromActiveMeeting(): Promise<void> {
    const file = this.deps.getActiveFile();
    if (!file) {
      this.deps.notice("Ассистент: откройте заметку встречи");
      return;
    }

    const fm = this.deps.getFrontmatterCache(file);
    const type = typeof fm?.assistant_type === "string" ? String(fm.assistant_type) : "";
    if (type !== "calendar_event") {
      this.deps.notice("Ассистент: активный файл — не заметка встречи");
      return;
    }

    const text = await this.deps.readFileText(file);
    const emails = extractEmailsFromTextPolicy(text);
    if (emails.length === 0) {
      this.deps.notice("Ассистент: не удалось извлечь email участников из тела заметки встречи");
      return;
    }

    let ensured = 0;
    for (const email of emails) {
      try {
        await this.deps.people.ensureByEmail({ email });
        ensured++;
      } catch (e) {
        this.deps.log.warn("Люди: обработка по email: ошибка (пропускаю)", { email, error: e });
      }
    }

    this.deps.notice(`Ассистент: карточки людей обработаны: ${ensured}`);
  }
}
