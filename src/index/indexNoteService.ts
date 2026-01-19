import type { App, Vault } from "obsidian";
import { normalizePath } from "obsidian";
import { ensureFolder } from "../vault/ensureFolder";
import { ensureFile } from "../vault/ensureFile";

/**
 * Сервис “Obsidian-native база/индекс”:
 * - создаёт папку индекса
 * - создаёт index notes (если их нет), не перезаписывая пользовательские изменения
 *
 * Зачем: дать “видимую базу” в vault (md + frontmatter), чтобы:
 * - Obsidian (`metadataCache`) и Dataview могли строить отчёты,
 * - человеку были доступны поиск/таблицы/фильтры без отдельной БД.
 */
export class IndexNoteService {
  private app: App;
  private vault: Vault;
  private indexDir: string;
  private eventsDir: string;
  private protocolsDir: string;
  private peopleDir: string;
  private projectsDir: string;

  constructor(
    app: App,
    params: {
      indexDir: string;
      eventsDir: string;
      protocolsDir: string;
      peopleDir: string;
      projectsDir: string;
    },
  ) {
    this.app = app;
    this.vault = app.vault;
    this.indexDir = normalizePath(params.indexDir);
    this.eventsDir = normalizePath(params.eventsDir);
    this.protocolsDir = normalizePath(params.protocolsDir);
    this.peopleDir = normalizePath(params.peopleDir);
    this.projectsDir = normalizePath(params.projectsDir);
  }

  /** Обновить пути (например, после изменения настроек). */
  setPaths(params: { indexDir: string; eventsDir: string; protocolsDir: string; peopleDir: string; projectsDir: string }): void {
    this.indexDir = normalizePath(params.indexDir);
    this.eventsDir = normalizePath(params.eventsDir);
    this.protocolsDir = normalizePath(params.protocolsDir);
    this.peopleDir = normalizePath(params.peopleDir);
    this.projectsDir = normalizePath(params.projectsDir);
  }

  /**
   * Убедиться, что папка и index notes существуют.
   *
   * Важно: не перезаписываем существующие файлы — это “пользовательская база”.
   */
  async ensureIndexNotes(): Promise<void> {
    if (!this.indexDir) return;
    await ensureFolder(this.vault, this.indexDir);

    await ensureFile(this.vault, normalizePath(`${this.indexDir}/Встречи.md`), renderMeetingsIndex(this.eventsDir));
    await ensureFile(this.vault, normalizePath(`${this.indexDir}/Протоколы.md`), renderProtocolsIndex(this.protocolsDir));
    await ensureFile(this.vault, normalizePath(`${this.indexDir}/Люди.md`), renderPeopleIndex(this.peopleDir));
    await ensureFile(this.vault, normalizePath(`${this.indexDir}/Проекты.md`), renderProjectsIndex(this.projectsDir));
  }
}

function renderMeetingsIndex(eventsDir: string): string {
  return [
    "# Встречи",
    "",
    "Этот файл создан плагином «Ассистент» как часть “Obsidian-native базы”.",
    "",
    "Если установлен Dataview — ниже будет таблица. Если Dataview нет, это просто код-блок и не мешает.",
    "",
    "```dataview",
    `TABLE start, end, summary, calendar_id, uid FROM "${eventsDir}"`,
    'WHERE assistant_type = "calendar_event"',
    "SORT start desc",
    "```",
    "",
    "Подсказка (без Dataview): используйте поиск Obsidian по `assistant_type: calendar_event`.",
    "",
  ].join("\n");
}

function renderProtocolsIndex(protocolsDir: string): string {
  return [
    "# Протоколы",
    "",
    "```dataview",
    `TABLE start, end, event_key FROM "${protocolsDir}"`,
    'WHERE assistant_type = "protocol"',
    "SORT start desc",
    "```",
    "",
    "Подсказка: поиск по `assistant_type: protocol`.",
    "",
  ].join("\n");
}

function renderPeopleIndex(peopleDir: string): string {
  return [
    "# Люди",
    "",
    "```dataview",
    `TABLE display_name, email FROM "${peopleDir}"`,
    'WHERE assistant_type = "person"',
    "SORT display_name asc",
    "```",
    "",
    "Пока это каркас: карточки людей можно создавать вручную.",
    "",
  ].join("\n");
}

function renderProjectsIndex(projectsDir: string): string {
  return [
    "# Проекты",
    "",
    "```dataview",
    `TABLE title, slug FROM "${projectsDir}"`,
    'WHERE assistant_type = "project"',
    "SORT title asc",
    "```",
    "",
    "Пока это каркас: карточки проектов можно создавать вручную.",
    "",
  ].join("\n");
}
