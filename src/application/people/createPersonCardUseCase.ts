import type { PersonRepository } from "../contracts/personRepository";
import { err, ok, type Result } from "../../shared/result";
import { APP_ERROR } from "../../shared/appErrorCodes";
import type { VaultFileLike } from "../../shared/vaultFileLike";

type Logger = { warn: (message: string, data?: Record<string, unknown>) => void };

export type CreatePersonCardUseCaseDeps = {
  people: PersonRepository;
  notice: (message: string) => void;
  log: Logger;
};

export class CreatePersonCardUseCase {
  constructor(private readonly deps: CreatePersonCardUseCaseDeps) {}

  async createAndOpenResult(params?: { displayName?: string }): Promise<Result<VaultFileLike>> {
    try {
      const file = await this.deps.people.createAndOpen(params);
      return ok(file);
    } catch (e) {
      const msg = String((e as unknown) ?? "неизвестная ошибка");
      return err({ code: APP_ERROR.VAULT_IO, message: "Ассистент: не удалось создать карточку человека", cause: msg });
    }
  }

  async createAndOpen(params?: { displayName?: string }): Promise<void> {
    const r = await this.createAndOpenResult(params);
    if (!r.ok) {
      this.deps.log.warn("Люди: создание карточки человека: ошибка", { code: r.error.code, error: r.error.cause });
      this.deps.notice(r.error.message);
    }
  }
}
