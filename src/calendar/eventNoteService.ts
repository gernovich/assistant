import type { App, TFile, Vault } from "obsidian";
import { normalizePath } from "obsidian";
import type { Event } from "../types";
import { ensureFolder } from "../vault/ensureFolder";
import { revealOrOpenInNewLeaf } from "../vault/revealOrOpenFile";
import { makeEventKey, makePersonIdFromEmail, shortStableId } from "../ids/stableIds";
import { createUniqueMarkdownFile, sanitizeFileName } from "../vault/fileNaming";
import { ensureFile, isTFile } from "../vault/ensureFile";
import { yamlEscape } from "../vault/yamlEscape";
import type { EventNoteIndexCache } from "./store/eventNoteIndexCache";
import { upsertFrontmatter } from "../vault/frontmatter";
import { FM } from "../vault/frontmatterKeys";
import { extractLegacyStableIdFromPath, legacyStableIdSuffix } from "../domain/policies/legacyStableId";
import { meetingNoteBaseName } from "../domain/policies/meetingNoteNaming";
import { wikiLinkLine } from "../domain/policies/wikiLink";
import { attendeesMarkdownBlockRu } from "../domain/policies/attendeesMarkdownRu";
import { buildMeetingFrontmatterData } from "../domain/policies/meetingFrontmatterData";
import { renderMeetingNoteMarkdown } from "../domain/policies/meetingNoteTemplate";
import {
  extractProtocolsBody,
  extractWikiLinkTargets,
  mergePreservingAssistantSections,
  upsertCancelledFlagInUserSection,
  upsertProtocolLink,
} from "../vault/markdownSections";

/**
 * Сервис заметок встреч (md-файлы в vault).
 *
 * Отвечает за:
 * - расчёт пути файла встречи (красивое имя файла; связь и поиск через `(calendar_id, event_id)`)
 * - создание/обновление файла встречи
 * - связь “встреча ↔ протоколы” через секцию `ASSISTANT:PROTOCOLS`
 */
export class EventNoteService {
  private app: App;
  private vault: Vault;
  private eventsDir: string;
  private indexCache?: EventNoteIndexCache;
  private eventKeyIndex = new Map<string, TFile>();
  private eventKeyIndexLoaded = false;

  /** @param eventsDir Папка встреч в vault. */
  constructor(app: App, eventsDir: string, indexCache?: EventNoteIndexCache) {
    this.app = app;
    this.vault = app.vault;
    this.eventsDir = normalizePath(eventsDir);
    this.indexCache = indexCache;
  }

  /** Обновить папку встреч (например после изменения настроек). */
  setEventsDir(eventsDir: string) {
    this.eventsDir = normalizePath(eventsDir);
    // Папка поменялась — индекс нужно пересобрать/перезагрузить.
    this.eventKeyIndex.clear();
    this.eventKeyIndexLoaded = false;
  }

  /** Рассчитать “идеальный” путь файла встречи по событию. */
  getEventFilePath(ev: Event): string {
    // Имя файла делаем “красивым” (без `[sid]`); связь и поиск держим через `(calendar_id, event_id)`.
    const pretty = meetingNoteBaseName({ summary: ev.summary, sanitizeFileName, maxLen: 80 });
    return normalizePath(`${this.eventsDir}/${pretty}.md`);
  }

  /** Прогреть индекс (загрузить persistent cache в память). */
  async warmUpIndex(): Promise<void> {
    await this.ensureEventKeyIndex();
  }

  // Ранее тут была локальная метка “план участия”.
  // Концепция убрана: теперь статус управляется напрямую в календаре (CalDAV write-back).

  /**
   * Найти файл встречи по “стабильному ключу” встречи (`calendarId:eventId`).
   *
   * Зачем: “DB-подобный” доступ к карточкам — имя файла не участвует в идентичности.
   */
  async findEventFileByEventKey(eventKey: string): Promise<TFile | null> {
    const key = String(eventKey ?? "").trim();
    if (!key) return null;

    const index = await this.ensureEventKeyIndex();
    const direct = index.get(key);
    if (direct) return direct;

    // Фоллбек: индекс мог быть пуст/устаревшим (metadataCache не готов сразу).
    // Перестраиваем по metadataCache и пробуем ещё раз.
    this.eventKeyIndex = this.buildEventKeyIndex();
    this.eventKeyIndexLoaded = true;
    const again = this.eventKeyIndex.get(key) ?? null;
    await this.persistEventKeyIndex();
    return again;
  }

  /** Синхронизировать набор событий в vault (создать/обновить файлы встреч). */
  async syncEvents(events: Event[]) {
    await ensureFolder(this.vault, this.eventsDir);
    const sidIndex = this.buildStableIdIndex();
    const eventKeyIndex = await this.ensureEventKeyIndex();
    for (const ev of events) {
      await this.upsertEvent(ev, sidIndex, eventKeyIndex);
    }
    await this.persistEventKeyIndex();
  }

  /** Открыть (или создать) файл встречи в новой вкладке. */
  async openEvent(ev: Event) {
    await ensureFolder(this.vault, this.eventsDir);
    const file = await this.ensureOrCreateEventFile(ev);
    await revealOrOpenInNewLeaf(this.app, file);
    await this.persistEventKeyIndex();
  }

  /** Убедиться, что файл встречи существует, и вернуть `TFile`. */
  async ensureEventFile(ev: Event): Promise<TFile> {
    await ensureFolder(this.vault, this.eventsDir);
    const file = await this.ensureOrCreateEventFile(ev);
    await this.persistEventKeyIndex();
    return file;
  }

  /** Добавить ссылку на протокол в секцию “Протоколы” в файле встречи. */
  async linkProtocol(ev: Event, protocolFile: TFile) {
    const evFile = await this.ensureEventFile(ev);
    const cur = await this.vault.read(evFile);
    const link = wikiLinkLine({ targetPath: protocolFile.path, label: protocolFile.basename });
    const updated = upsertProtocolLink(cur, link);
    if (updated !== cur) await this.vault.modify(evFile, updated);
  }

  /** Список файлов протоколов, связанных со встречей (парсинг wiki-link из секции “Протоколы”). */
  async listProtocolFiles(ev: Event): Promise<TFile[]> {
    const evFile = await this.ensureEventFile(ev);
    const cur = await this.vault.read(evFile);
    const body = extractProtocolsBody(cur);
    const targets = extractWikiLinkTargets(body);
    const out: TFile[] = [];
    for (const t of targets) {
      const path = t.endsWith(".md") ? t : `${t}.md`;
      const f = this.vault.getAbstractFileByPath(path);
      if (f && isTFile(f)) out.push(f);
    }
    return out;
  }

  /** Список протоколов + дата `start` (если удалось извлечь из frontmatter). */
  async listProtocolInfos(ev: Event): Promise<Array<{ file: TFile; start?: Date }>> {
    const files = await this.listProtocolFiles(ev);
    const out: Array<{ file: TFile; start?: Date }> = [];
    for (const f of files) {
      const start = this.getFileFrontmatterDate(f, FM.start);
      out.push({ file: f, start });
    }
    // Сортируем “последние сверху”; элементы без start — в конце.
    out.sort((a, b) => {
      const at = a.start?.getTime();
      const bt = b.start?.getTime();
      if (at == null && bt == null) return 0;
      if (at == null) return 1;
      if (bt == null) return -1;
      return bt - at;
    });
    return out;
  }

  private getFileFrontmatterDate(file: TFile, key: string): Date | undefined {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    const raw = fm ? (fm as Record<string, unknown>)[key] : undefined;
    if (raw instanceof Date) return raw;
    if (typeof raw === "string") {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return undefined;
  }

  /** Пометить встречу как отменённую (в пользовательской секции файла встречи). */
  async markCancelled(ev: Event) {
    const evFile = await this.ensureEventFile(ev);
    const cur = await this.vault.read(evFile);
    const updated = upsertCancelledFlagInUserSection(cur);
    if (updated !== cur) await this.vault.modify(evFile, updated);
  }

  private async upsertEvent(ev: Event, sidIndex: Map<string, TFile>, eventKeyIndex: Map<string, TFile>) {
    const file = await this.resolveOrCreateFileForEvent(ev, sidIndex, eventKeyIndex);
    const cur = await this.vault.read(file);
    const updated = mergePreservingAssistantSections(cur, renderEventFile(ev, false));
    await this.vault.modify(file, updated);
  }

  private async ensureOrCreateEventFile(ev: Event): Promise<TFile> {
    const sidIndex = this.buildStableIdIndex();
    const eventKeyIndex = await this.ensureEventKeyIndex();
    return await this.resolveOrCreateFileForEvent(ev, sidIndex, eventKeyIndex, true);
  }

  private async resolveOrCreateFileForEvent(
    ev: Event,
    sidIndex: Map<string, TFile>,
    eventKeyIndex: Map<string, TFile>,
    includeUserSections = false,
  ): Promise<TFile> {
    const eventKey = makeEventKey(ev.calendar.id, ev.id);
    const sid = shortStableId(eventKey, 6);
    const target = this.getEventFilePath(ev);

    // 1) Основной путь: ищем по `(calendar_id, event_id)` (frontmatter) — имя файла не важно.
    const existingByKey = eventKeyIndex.get(eventKey);
    if (existingByKey) {
      // Переименовываем в красивое имя при изменении summary (без [sid]).
      if (existingByKey.path !== target) {
        const renamed = await this.tryRenameToTarget(existingByKey, target);
        return renamed;
      }
      return existingByKey;
    }

    // 2) Legacy: ищем по [sid] в имени (для старых файлов).
    const existingBySid = sidIndex.get(sid) ?? this.findEventFileByStableId(sid);
    if (existingBySid) {
      // Переводим на красивое имя без [sid] (если возможно), сохраняя связь через `(calendar_id, event_id)`.
      const renamed = existingBySid.path !== target ? await this.tryRenameToTarget(existingBySid, target) : existingBySid;
      eventKeyIndex.set(eventKey, renamed);
      return renamed;
    }

    // 3) Создаём новый файл с красивым именем (с авто-суффиксами при коллизиях).
    const pretty = meetingNoteBaseName({ summary: ev.summary, sanitizeFileName, maxLen: 80 });
    const content = renderEventFile(ev, includeUserSections);
    const created = await createUniqueMarkdownFile(this.vault, this.eventsDir, pretty, content);
    eventKeyIndex.set(eventKey, created);
    return created;
  }

  private async tryRenameToTarget(file: TFile, targetPath: string): Promise<TFile> {
    try {
      await this.vault.rename(file, targetPath);
      return file;
    } catch {
      // Если rename не удался (коллизия/права) — остаёмся на текущем пути.
      return file;
    }
  }

  /**
   * Build index of existing event notes in eventsDir: stableId (sid) -> file
   * This avoids O(N vault files) scans per event during syncEvents().
   */
  private buildStableIdIndex(): Map<string, TFile> {
    const dirPrefix = normalizePath(this.eventsDir) + "/";
    const out = new Map<string, TFile>();
    const files = this.vault.getFiles();
    for (const f of files) {
      if (!f.path.startsWith(dirPrefix)) continue;
      const sid = extractLegacyStableIdFromPath(f.path);
      if (sid) out.set(sid, f);
    }
    return out;
  }

  /**
   * Индекс существующих заметок встреч по frontmatter `(calendar_id, event_id)`.
   *
   * Это “DB-подобный” слой: позволяет находить файл встречи по ID, не полагаясь на имя файла.
   */
  private buildEventKeyIndex(): Map<string, TFile> {
    const dirPrefix = normalizePath(this.eventsDir) + "/";
    const out = new Map<string, TFile>();
    const files = this.vault.getFiles();
    for (const f of files) {
      if (!f.path.startsWith(dirPrefix)) continue;
      const cache = this.app.metadataCache.getFileCache(f);
      const fm = cache?.frontmatter as Record<string, unknown> | undefined;
      const calId = typeof fm?.[FM.calendarId] === "string" ? String(fm[FM.calendarId]) : "";
      const evId = typeof fm?.[FM.eventId] === "string" ? String(fm[FM.eventId]) : "";
      const key = calId && evId ? makeEventKey(calId, evId) : "";
      if (key) out.set(key, f);
    }
    return out;
  }

  private async ensureEventKeyIndex(): Promise<Map<string, TFile>> {
    if (this.eventKeyIndexLoaded) return this.eventKeyIndex;
    this.eventKeyIndexLoaded = true;

    // 1) Пытаемся загрузить persistent cache.
    if (this.indexCache) {
      try {
        const loaded = await this.indexCache.load(this.vault, this.eventsDir);
        this.eventKeyIndex = loaded;
      } catch {
        // ignore
      }
    }

    // 2) Если кэш пуст — строим по metadataCache.
    if (this.eventKeyIndex.size === 0) {
      this.eventKeyIndex = this.buildEventKeyIndex();
    }
    return this.eventKeyIndex;
  }

  private async persistEventKeyIndex(): Promise<void> {
    if (!this.indexCache) return;
    if (!this.eventKeyIndexLoaded) return;
    await this.indexCache.save({ eventsDir: this.eventsDir, byEventKey: this.eventKeyIndex });
  }

  private findEventFileByStableId(sid: string): TFile | undefined {
    const suffix = legacyStableIdSuffix(sid);
    const dirPrefix = normalizePath(this.eventsDir) + "/";
    const files = this.vault.getFiles();
    for (const f of files) {
      if (!f.path.startsWith(dirPrefix)) continue;
      if (f.path.endsWith(suffix)) return f;
    }
    return undefined;
  }
}

function renderEventFile(ev: Event, includeUserSections: boolean): string {
  const fm = buildMeetingFrontmatterData(ev);
  return renderMeetingNoteMarkdown({
    fm,
    description: ev.description,
    attendeesMarkdown: renderAttendeesBlock(ev.attendees ?? []),
    includeUserSections,
    keys: {
      assistantType: FM.assistantType,
      calendarId: FM.calendarId,
      eventId: FM.eventId,
      summary: FM.summary,
      start: FM.start,
      end: FM.end,
      url: FM.url,
      location: FM.location,
      status: FM.status,
      organizerEmail: FM.organizerEmail,
      organizerCn: FM.organizerCn,
      attendees: FM.attendees,
      attendeesAccepted: FM.attendeesAccepted,
      attendeesDeclined: FM.attendeesDeclined,
      attendeesTentative: FM.attendeesTentative,
      attendeesNeedsAction: FM.attendeesNeedsAction,
      attendeesUnknown: FM.attendeesUnknown,
    },
    escape: yamlEscape,
  });
}

// yamlEscape перенесён в src/vault/yamlEscape.ts

function renderAttendeesBlock(attendees: Array<{ email: string; cn?: string; partstat?: string }>): string {
  return attendeesMarkdownBlockRu(attendees);
}

// ensureFile перенесён в src/vault/ensureFile.ts
