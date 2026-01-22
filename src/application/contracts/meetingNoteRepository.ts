import type { Event } from "../../types";

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
}

