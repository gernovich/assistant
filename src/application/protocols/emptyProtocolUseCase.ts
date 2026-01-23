import type { ProtocolNoteRepository } from "../contracts/protocolNoteRepository";
import { err, ok, type Result } from "../../shared/result";
import { APP_ERROR } from "../../shared/appErrorCodes";

export type EmptyProtocolUseCaseDeps = {
  protocols: ProtocolNoteRepository;
};

export class EmptyProtocolUseCase {
  constructor(private readonly deps: EmptyProtocolUseCaseDeps) {}

  async createAndOpenResult(): Promise<Result<{ filePath: string }>> {
    try {
      const file = await this.deps.protocols.createEmptyProtocol();
      await this.deps.protocols.openProtocol(file);
      return ok({ filePath: file.path });
    } catch (e) {
      const msg = String((e as unknown) ?? "неизвестная ошибка");
      return err({ code: APP_ERROR.VAULT_IO, message: "Не удалось создать/открыть протокол", cause: msg });
    }
  }

  async createAndOpen(): Promise<void> {
    await this.createAndOpenResult();
  }
}

