import type { ProjectRepository } from "../contracts/projectRepository";
import { err, ok, type Result } from "../../shared/result";
import { APP_ERROR } from "../../shared/appErrorCodes";
import type { VaultFileLike } from "../../shared/vaultFileLike";

type Logger = { warn: (message: string, data?: Record<string, unknown>) => void };

export type CreateProjectCardUseCaseDeps = {
  projects: ProjectRepository;
  notice: (message: string) => void;
  log: Logger;
};

export class CreateProjectCardUseCase {
  constructor(private readonly deps: CreateProjectCardUseCaseDeps) {}

  async createAndOpenResult(params?: { title?: string }): Promise<Result<VaultFileLike>> {
    try {
      const file = await this.deps.projects.createAndOpen(params);
      return ok(file);
    } catch (e) {
      const msg = String((e as unknown) ?? "неизвестная ошибка");
      return err({ code: APP_ERROR.VAULT_IO, message: "Ассистент: не удалось создать карточку проекта", cause: msg });
    }
  }

  async createAndOpen(params?: { title?: string }): Promise<void> {
    const r = await this.createAndOpenResult(params);
    if (!r.ok) {
      this.deps.log.warn("Projects: create project card: ошибка", { code: r.error.code, error: r.error.cause });
      this.deps.notice(r.error.message);
    }
  }
}
