import type { Event } from "../../types";
import type { VaultFileLike } from "../../shared/vaultFileLike";

/**
 * Порт доступа к заметкам встреч (vault).
 *
 * Это граница Application слоя: use-cases/оркестраторы зависят от интерфейса,
 * а конкретная реализация (Obsidian Vault / файловая система) живёт в Infrastructure.
 *
 * На старте `EventNoteService` структурно соответствует этому интерфейсу.
 */
export interface MeetingNoteRepository {
  setEventsDir(eventsDir: string): void;
  warmUpIndex(): Promise<void>;
  syncEvents(events: Event[]): Promise<void>;
  openEvent(ev: Event): Promise<void>;

  // Протоколы, связанные со встречей (через секции/ссылки в md).
  ensureEventFile(ev: Event): Promise<VaultFileLike>;
  linkProtocol(ev: Event, protocolFile: VaultFileLike): Promise<void>;
  listProtocolInfos(ev: Event): Promise<Array<{ file: VaultFileLike; start?: Date }>>;
}
