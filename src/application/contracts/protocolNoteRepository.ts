import type { TFile } from "obsidian";
import type { Event } from "../../types";

export interface ProtocolNoteRepository {
  createProtocolFromEvent(ev: Event, eventFilePath?: string): Promise<TFile>;
  createEmptyProtocol(): Promise<TFile>;
  openProtocol(file: TFile): Promise<void>;
}

