import type { App, TFile, Vault } from "obsidian";
import { normalizePath } from "obsidian";
import type { CalendarEvent } from "../types";
import { ensureFolder } from "../vault/ensureFolder";
import { revealOrOpenInNewLeaf } from "../vault/revealOrOpenFile";
import { createUniqueMarkdownFile } from "../vault/fileNaming";
import { makeEventKey } from "../ids/stableIds";

export class ProtocolNoteService {
  private app: App;
  private vault: Vault;
  private protocolsDir: string;

  constructor(app: App, protocolsDir: string) {
    this.app = app;
    this.vault = app.vault;
    this.protocolsDir = normalizePath(protocolsDir);
  }

  setProtocolsDir(protocolsDir: string) {
    this.protocolsDir = normalizePath(protocolsDir);
  }

  async createProtocolFromEvent(ev: CalendarEvent, eventFilePath?: string): Promise<TFile> {
    await ensureFolder(this.vault, this.protocolsDir);

    // Human-friendly file name (no UID in name). Uniqueness via " 2/3/..."
    const baseName = `${ev.summary} ${formatRuDate(ev.start)}`;

    const content = renderProtocol(ev, eventFilePath);
    const file = await createUniqueMarkdownFile(this.vault, this.protocolsDir, baseName, content);
    return file;
  }

  async openProtocol(file: TFile) {
    await revealOrOpenInNewLeaf(this.app, file);
  }
}

function renderProtocol(ev: CalendarEvent, eventFilePath?: string): string {
  const startIso = ev.start.toISOString();
  const endIso = ev.end ? ev.end.toISOString() : "";
  const eventKey = makeEventKey(ev.calendarId, ev.uid);
  const eventLinkTarget = eventFilePath ? eventFilePath.replace(/\.md$/i, "") : "";
  return [
    "---",
    `assistant_type: protocol`,
    `event_key: ${yamlEscape(eventKey)}`,
    `calendar_id: ${yamlEscape(ev.calendarId)}`,
    `uid: ${yamlEscape(ev.uid)}`,
    `start: ${yamlEscape(startIso)}`,
    `end: ${yamlEscape(endIso)}`,
    "---",
    "",
    `## ${ev.summary}`,
    "",
    "### Встреча (календарь)",
    "",
    eventLinkTarget ? `- [[${eventLinkTarget}|Встреча]]` : "- [[Встреча]]",
    "",
    "### Ссылки",
    "",
    ev.url ? `- Ссылка: ${ev.url}` : "- Ссылка: ",
    "",
    "### Запись",
    "",
    "- Файл записи: ",
    "",
    "### Транскрипт",
    "",
    "- (пока пусто)",
    "",
    "### Саммари",
    "",
    "- Короткое: ",
    "- Для календаря: ",
    "- Расширенное: ",
    "",
    "### Окраска",
    "",
    "- (пока пусто)",
    "",
    "### Факты / обещания / задачи",
    "",
    "- (пока пусто)",
    "",
    "### Люди",
    "",
    "- (пока пусто)",
    "",
    "### Проекты",
    "",
    "- (пока пусто)",
    "",
  ].join("\n");
}

function yamlEscape(v: string): string {
  const s = (v ?? "").replace(/\r?\n/g, " ").trim();
  return JSON.stringify(s);
}

function formatRuDate(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "long" });
}

