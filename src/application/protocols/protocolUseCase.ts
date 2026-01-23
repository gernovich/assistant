import type { Event } from "../../types";
import type { MeetingNoteRepository } from "../contracts/meetingNoteRepository";
import type { ProtocolNoteRepository } from "../contracts/protocolNoteRepository";
import { sameLocalDate } from "../../domain/policies/sameLocalDate";
import { err, ok, type Result } from "../../shared/result";
import { APP_ERROR } from "../../shared/appErrorCodes";
import type { VaultFileLike } from "../../shared/vaultFileLike";

export type ProtocolMenuState = {
  hasCurrent: boolean;
  hasLatest: boolean;
  currentIsLatest: boolean;
};

type Logger = {
  info: (message: string, data?: Record<string, unknown>) => void;
};

export type ProtocolUseCaseDeps = {
  meetingNotes: MeetingNoteRepository;
  protocols: ProtocolNoteRepository;
  notice: (message: string) => void;
  log: Logger;
};

export class ProtocolUseCase {
  constructor(private readonly deps: ProtocolUseCaseDeps) {}

  async getMenuState(ev: Event): Promise<ProtocolMenuState> {
    const infos = await this.deps.meetingNotes.listProtocolInfos(ev);
    if (infos.length === 0) return { hasCurrent: false, hasLatest: false, currentIsLatest: false };

    const latest = infos[0];
    const current = infos.find((p) => p.start && sameLocalDate(p.start, ev.start));
    const hasCurrent = Boolean(current);
    const hasLatest = true;
    const currentIsLatest = hasCurrent && current?.file.path === latest.file.path;
    return { hasCurrent, hasLatest, currentIsLatest };
  }

  async openCurrent(ev: Event): Promise<void> {
    const infos = await this.deps.meetingNotes.listProtocolInfos(ev);
    const current = infos.find((p) => p.start && sameLocalDate(p.start, ev.start));
    if (!current) {
      this.deps.notice("Ассистент: нет протокола на эту дату");
      return;
    }
    await this.deps.protocols.openProtocol(current.file);
  }

  async openLatest(ev: Event): Promise<void> {
    const infos = await this.deps.meetingNotes.listProtocolInfos(ev);
    if (infos.length === 0) {
      this.deps.notice("Ассистент: у встречи пока нет протоколов");
      return;
    }
    await this.deps.protocols.openProtocol(infos[0].file);
  }

  /**
   * UX:
   * - если у встречи уже есть протокол “на текущую дату” — просто открываем его
   * - иначе: создаём файл встречи (если надо), создаём протокол, открываем и линкуем во встречу
   */
  async createOrOpenFromEventResult(ev: Event): Promise<Result<VaultFileLike>> {
    // Важно: не используем throw — возвращаем Result на границе Application.
    const r = await this.createOrOpenFromEventResultInternal(ev);
    return r;
  }

  private async createOrOpenFromEventResultInternal(ev: Event): Promise<Result<VaultFileLike>> {
    try {
      const infos = await this.deps.meetingNotes.listProtocolInfos(ev);
      const current = infos.find((p) => p.start && sameLocalDate(p.start, ev.start));
      if (current) {
        await this.deps.protocols.openProtocol(current.file);
        return ok(current.file);
      }

      // Нет протокола “на эту дату” — создаём новый.
      const eventFile = await this.deps.meetingNotes.ensureEventFile(ev);
      const protocolFile = await this.deps.protocols.createProtocolFromEvent(ev, eventFile.path);
      await this.deps.protocols.openProtocol(protocolFile);
      await this.deps.meetingNotes.linkProtocol(ev, protocolFile);
      this.deps.log.info("Создан новый протокол из встречи", { protocol: protocolFile.path });
      return ok(protocolFile);
    } catch (e) {
      const msg = String((e as unknown) ?? "неизвестная ошибка");
      this.deps.notice("Ассистент: не удалось создать/открыть протокол (подробности в логе)");
      return err({ code: APP_ERROR.VAULT_IO, message: "Не удалось создать/открыть протокол из встречи", cause: msg });
    }
  }

  /** Backward-compatible wrapper: не бросаем исключения наружу. */
  async createOrOpenFromEvent(ev: Event): Promise<VaultFileLike> {
    const r = await this.createOrOpenFromEventResult(ev);
    if (!r.ok) {
      // В старом API вернуть нечего — возвращаем “пустой” dummy через исключение нельзя.
      // Возвращаем promise reject без throw (и без падения UI, т.к. вызовы обычно fire-and-forget).
      return await Promise.reject(r.error.message);
    }
    return r.value;
  }
}

