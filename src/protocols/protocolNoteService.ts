import type { App, TFile, Vault } from "obsidian";
import { normalizePath } from "obsidian";
import type { Event } from "../types";
import { ensureFolder } from "../vault/ensureFolder";
import { revealOrOpenInNewLeaf } from "../vault/revealOrOpenFile";
import { createUniqueMarkdownFile } from "../vault/fileNaming";
import { makeEventKey } from "../ids/stableIds";
import { yamlEscape } from "../domain/policies/yamlEscape";
import { FM } from "../domain/policies/frontmatterKeys";
import { parseMeetingNoteFromMd } from "../domain/policies/frontmatterDtos";
import { makePseudoRandomId } from "../domain/policies/pseudoRandomId";
import { emptyProtocolBaseName, protocolBaseNameFromEvent } from "../domain/policies/protocolNoteNaming";
import { renderEmptyProtocolMarkdown, renderProtocolMarkdown } from "../domain/policies/protocolNoteTemplate";
import { protocolTargetDir } from "../domain/policies/protocolFolderLayout";
import { makeCalendarStub } from "../domain/policies/calendarStub";
import type { ProtocolNoteRepository } from "../application/contracts/protocolNoteRepository";

/** Сервис создания/открытия протоколов встреч (md-файлы в vault). */
export class ProtocolNoteService implements ProtocolNoteRepository {
  private app: App;
  private vault: Vault;
  private protocolsDir: string;
  private getLogService?: () => { warn: (message: string, data?: Record<string, unknown>) => void };

  /** @param protocolsDir Папка протоколов в vault. */
  constructor(
    app: App,
    protocolsDir: string,
    params?: { logService?: () => { warn: (message: string, data?: Record<string, unknown>) => void } },
  ) {
    this.app = app;
    this.vault = app.vault;
    this.protocolsDir = normalizePath(protocolsDir);
    this.getLogService = params?.logService;
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
    const targetDir = normalizePath(
      protocolTargetDir({
        protocolsDir: this.protocolsDir,
        meetingFilePath: eventFilePath,
      }),
    );
    await ensureFolder(this.vault, targetDir || this.protocolsDir);

    // Человекочитаемое имя файла (без UID). Уникальность через суффиксы " 2/3/...".
    const baseName = protocolBaseNameFromEvent({ summary: ev.summary, start: ev.start });

    const content = renderProtocolMarkdown({
      ev,
      eventFilePath,
      keys: {
        assistantType: FM.assistantType,
        protocolId: FM.protocolId,
        calendarId: FM.calendarId,
        start: FM.start,
        end: FM.end,
        summary: FM.summary,
        transcript: FM.transcript,
        files: FM.files,
        participants: FM.participants,
        projects: FM.projects,
      },
      escape: yamlEscape,
      makeEventKey,
    });
    const file = await createUniqueMarkdownFile(this.vault, targetDir || this.protocolsDir, baseName, content);
    return file;
  }

  /**
   * Создать пустой протокол (ручной старт).
   * Зачем: чтобы у “Протоколы” тоже был простой шаблон/команда, даже без календаря.
   */
  async createEmptyProtocol(): Promise<TFile> {
    const targetDir = normalizePath(
      protocolTargetDir({
        protocolsDir: this.protocolsDir,
      }),
    );
    await ensureFolder(this.vault, targetDir || this.protocolsDir);
    const now = new Date();
    const baseName = emptyProtocolBaseName(now);
    const uid = makePseudoRandomId({ prefix: "manual", nowMs: Date.now(), randomHex: Math.random().toString(16).slice(2) });
    const id = makeEventKey("manual", uid);
    const content = renderEmptyProtocolMarkdown({
      id,
      startIso: now.toISOString(),
      keys: {
        assistantType: FM.assistantType,
        protocolId: FM.protocolId,
        calendarId: FM.calendarId,
        start: FM.start,
        end: FM.end,
        summary: FM.summary,
        transcript: FM.transcript,
        files: FM.files,
        participants: FM.participants,
        projects: FM.projects,
      },
      escape: yamlEscape,
    });
    return await createUniqueMarkdownFile(this.vault, targetDir || this.protocolsDir, baseName, content);
  }

  /**
   * Создать протокол из открытой карточки встречи (md).
   * Читает frontmatter `calendar_id/event_id/summary/start/end/url/location`.
   */
  async createProtocolFromMeetingFile(meetingFile: TFile): Promise<TFile> {
    const text = await this.vault.read(meetingFile);
    const mr = parseMeetingNoteFromMd(text, { fileBasename: meetingFile.basename });
    if (!mr.ok) {
      this.getLogService?.().warn("Протокол: не удалось распарсить карточку встречи (frontmatter)", {
        code: mr.error.code,
        error: mr.error.message,
        file: meetingFile.path,
      });
      // Не ломаем UX: всё равно создаём “ручной” пустой протокол.
      return await this.createEmptyProtocol();
    }
    const m = mr.value;
    const calendarId = String(m.calendar_id ?? "manual");
    const uid = String(
      m.event_id ?? makePseudoRandomId({ prefix: "manual", nowMs: Date.now(), randomHex: Math.random().toString(16).slice(2) }),
    );
    const summary = String(m.summary ?? meetingFile.basename ?? "Встреча");
    const startIso = String(m.start ?? "");
    const endIso = String(m.end ?? "");

    const ev: Event = {
      calendar: makeCalendarStub({ id: calendarId, name: "" }),
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
