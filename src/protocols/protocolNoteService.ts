import type { App, TFile, Vault } from "obsidian";
import { normalizePath } from "obsidian";
import type { Event } from "../types";
import { ensureFolder } from "../vault/ensureFolder";
import { revealOrOpenInNewLeaf } from "../vault/revealOrOpenFile";
import { createUniqueMarkdownFile } from "../vault/fileNaming";
import { makeEventKey } from "../ids/stableIds";
import { yamlEscape } from "../vault/yamlEscape";
import { FM } from "../vault/frontmatterKeys";
import { parseMeetingNoteFromMd } from "../vault/frontmatterDtos";

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
  async createProtocolFromEvent(ev: Event, eventFilePath?: string): Promise<TFile> {
    await ensureFolder(this.vault, this.protocolsDir);

    // Человекочитаемое имя файла (без UID). Уникальность через суффиксы " 2/3/...".
    const baseName = `${ev.summary} ${formatRuDate(ev.start)}`;

    const content = renderProtocol(ev, eventFilePath);
    const file = await createUniqueMarkdownFile(this.vault, this.protocolsDir, baseName, content);
    return file;
  }

  /**
   * Создать пустой протокол (ручной старт).
   * Зачем: чтобы у “Протоколы” тоже был простой шаблон/команда, даже без календаря.
   */
  async createEmptyProtocol(): Promise<TFile> {
    await ensureFolder(this.vault, this.protocolsDir);
    const now = new Date();
    const baseName = `Протокол ${formatRuDate(now)}`;
    const uid = makeManualUid();
    const id = makeEventKey("manual", uid);
    const content = renderEmptyProtocol({ id, uid, startIso: now.toISOString() });
    return await createUniqueMarkdownFile(this.vault, this.protocolsDir, baseName, content);
  }

  /**
   * Создать протокол из открытой карточки встречи (md).
   * Читает frontmatter `calendar_id/event_id/summary/start/end/url/location`.
   */
  async createProtocolFromMeetingFile(meetingFile: TFile): Promise<TFile> {
    const text = await this.vault.read(meetingFile);
    const m = parseMeetingNoteFromMd(text, { fileBasename: meetingFile.basename });
    const calendarId = String(m.calendar_id ?? "manual");
    const uid = String(m.event_id ?? makeManualUid());
    const summary = String(m.summary ?? meetingFile.basename ?? "Встреча");
    const startIso = String(m.start ?? "");
    const endIso = String(m.end ?? "");

    const ev: Event = {
      calendar: { id: calendarId, name: "", type: "ics_url", config: { id: calendarId, name: "", type: "ics_url", enabled: true } as any },
      id: uid,
      summary,
      start: startIso ? new Date(startIso) : new Date(),
      end: endIso ? new Date(endIso) : undefined,
      location: typeof m.location === "string" ? String(m.location) : undefined,
      url: typeof m.url === "string" ? String(m.url) : undefined,
    };
    return await this.createProtocolFromEvent(ev, meetingFile.path);
  }

  /** Открыть протокол в новой вкладке (или сфокусировать, если уже открыт). */
  async openProtocol(file: TFile) {
    await revealOrOpenInNewLeaf(this.app, file);
  }
}

function renderProtocol(ev: Event, eventFilePath?: string): string {
  const startIso = ev.start.toISOString();
  const endIso = ev.end ? ev.end.toISOString() : "";
  const eventKey = makeEventKey(ev.calendar.id, ev.id);
  const eventLinkTarget = eventFilePath ? eventFilePath.replace(/\.md$/i, "") : "";
  return [
    "---",
    `${FM.assistantType}: protocol`,
    `${FM.protocolId}: ${yamlEscape(eventKey)}`,
    `${FM.calendarId}: ${yamlEscape(ev.calendar.id)}`,
    `${FM.start}: ${yamlEscape(startIso)}`,
    `${FM.end}: ${yamlEscape(endIso)}`,
    `${FM.summary}: `,
    `${FM.transcript}: `,
    `${FM.files}: []`,
    `${FM.participants}: []`,
    `${FM.projects}: []`,
    "---",
    "",
    `## ${ev.summary}`,
    "",
    "### Встреча (календарь)",
    "",
    eventLinkTarget ? `- [[${eventLinkTarget}|Встреча]]` : "- [[Встреча]]",
    "",
    "### Расшифровка",
    "",
    "- (вставь транскрипт сюда)",
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

function makeManualUid(): string {
  return `manual-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

function renderEmptyProtocol(params: { id: string; uid: string; startIso: string }): string {
  return [
    "---",
    `${FM.assistantType}: protocol`,
    `${FM.protocolId}: ${yamlEscape(params.id)}`,
    `${FM.calendarId}: ${yamlEscape("manual")}`,
    `${FM.start}: ${yamlEscape(params.startIso)}`,
    `${FM.end}: `,
    `${FM.summary}: `,
    `${FM.transcript}: `,
    `${FM.files}: []`,
    `${FM.participants}: []`,
    `${FM.projects}: []`,
    "---",
    "",
    "## Протокол",
    "",
    "### Встреча (карточка)",
    "",
    "- [[Встреча]]",
    "",
    "### Расшифровка",
    "",
    "- (вставь транскрипт сюда)",
    "",
    "### Саммари",
    "",
    "- Короткое: ",
    "- Для календаря: ",
    "- Расширенное: ",
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
