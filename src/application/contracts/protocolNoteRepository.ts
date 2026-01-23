import type { Event } from "../../types";
import type { VaultFileLike } from "../../shared/vaultFileLike";

export interface ProtocolNoteRepository {
  createProtocolFromEvent(ev: Event, eventFilePath?: string): Promise<VaultFileLike>;
  createProtocolFromMeetingFile(meetingFile: VaultFileLike): Promise<VaultFileLike>;
  createEmptyProtocol(): Promise<VaultFileLike>;
  openProtocol(file: VaultFileLike): Promise<void>;
}

