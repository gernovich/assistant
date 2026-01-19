import type { App, TFile, Vault } from "obsidian";
import { normalizePath } from "obsidian";
import type { CalendarEvent } from "../types";
import { ensureFolder } from "../vault/ensureFolder";
import { revealOrOpenInNewLeaf } from "../vault/revealOrOpenFile";
import { createUniqueMarkdownFile } from "../vault/fileNaming";
import { makeEventKey } from "../ids/stableIds";
import { yamlEscape } from "../vault/yamlEscape";

/** Сервис создания/открытия протоколов встреч (md-файлы в vault). */
export class ProtocolNoteService {
  private app: App;
  private vault: Vault;
  private protocolsDir: string;

  /** @param protocolsDir Папка протоколов в vault. */
  constructor(app: App, protocolsDir: string) {
    this.app = app;
    this.vault = app.vault;
    this.protocolsDir = normalizePath(protocolsDir);
  }

  /** Обновить папку протоколов (например после изменения настроек). */
  setProtocolsDir(protocolsDir: string) {
    this.protocolsDir = normalizePath(protocolsDir);
  }

  /**
   * Создать протокол из события календаря.
   * Имя файла человекочитаемое, уникальность обеспечиваем суффиксами ` 2/3/...`.
   */
  async createProtocolFromEvent(ev: CalendarEvent, eventFilePath?: string): Promise<TFile> {
    await ensureFolder(this.vault, this.protocolsDir);

    // Человекочитаемое имя файла (без UID). Уникальность через суффиксы " 2/3/...".
    const baseName = `${ev.summary} ${formatRuDate(ev.start)}`;

    const content = renderProtocol(ev, eventFilePath);
    const file = await createUniqueMarkdownFile(this.vault, this.protocolsDir, baseName, content);
    return file;
  }

  /** Открыть протокол в новой вкладке (или сфокусировать, если уже открыт). */
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

// yamlEscape moved to src/vault/yamlEscape.ts

function formatRuDate(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "long" });
}
