import type { App, Vault } from "obsidian";
import { normalizePath } from "obsidian";
import { ensureFile, isTFile } from "../vault/ensureFile";

/**
 * “.base” слой для работы с карточками.
 *
 * Идея структуры:
 * - `Ассистент/Встречи/*` — карточки (md-файлы встреч)
 * - `Ассистент/Встречи.base` — файл базы (встроенный плагин Obsidian “Базы данных / Bases”)
 *
 * Важно: не требует Dataview. Формат `.base` — YAML-конфиг для core plugin.
 */
export class BaseWorkspaceService {
  private app: App;
  private vault: Vault;

  private meetingsDir: string;
  private protocolsDir: string;
  private peopleDir: string;
  private projectsDir: string;

  private meetingsBaseFile: string;
  private protocolsBaseFile: string;
  private peopleBaseFile: string;
  private projectsBaseFile: string;

  constructor(
    app: App,
    params: {
      meetingsDir: string;
      protocolsDir: string;
      peopleDir: string;
      projectsDir: string;
    },
  ) {
    this.app = app;
    this.vault = app.vault;

    this.meetingsDir = normalizePath(params.meetingsDir);
    this.protocolsDir = normalizePath(params.protocolsDir);
    this.peopleDir = normalizePath(params.peopleDir);
    this.projectsDir = normalizePath(params.projectsDir);

    this.meetingsBaseFile = normalizePath(`${this.meetingsDir}.base`);
    this.protocolsBaseFile = normalizePath(`${this.protocolsDir}.base`);
    this.peopleBaseFile = normalizePath(`${this.peopleDir}.base`);
    this.projectsBaseFile = normalizePath(`${this.projectsDir}.base`);
  }

  /** Обновить пути после изменения настроек. */
  setPaths(params: { meetingsDir: string; protocolsDir: string; peopleDir: string; projectsDir: string }): void {
    this.meetingsDir = normalizePath(params.meetingsDir);
    this.protocolsDir = normalizePath(params.protocolsDir);
    this.peopleDir = normalizePath(params.peopleDir);
    this.projectsDir = normalizePath(params.projectsDir);

    this.meetingsBaseFile = normalizePath(`${this.meetingsDir}.base`);
    this.protocolsBaseFile = normalizePath(`${this.protocolsDir}.base`);
    this.peopleBaseFile = normalizePath(`${this.peopleDir}.base`);
    this.projectsBaseFile = normalizePath(`${this.projectsDir}.base`);
  }

  /**
   * Убедиться, что файлы `*.base` существуют.
   *
   * Важно: существующие `.base` файлы не перезаписываем — пользователь будет править views руками.
   */
  async ensureBaseFiles(): Promise<void> {
    await ensureFile(
      this.vault,
      this.meetingsBaseFile,
      renderBaseYaml({
        name: "Встречи",
        inFolder: this.meetingsDir,
        order: [
          "start",
          "end",
          "summary",
          "calendar_id",
          "event_id",
          "organizer_email",
          "status",
          "attendees_accepted",
          "attendees_declined",
          "attendees_tentative",
          "attendees_needs_action",
          "attendees_unknown",
          "attendees",
        ],
      }),
    );
    await ensureFile(
      this.vault,
      this.protocolsBaseFile,
      renderBaseYaml({
        name: "Протоколы",
        inFolder: this.protocolsDir,
        order: ["start", "end", "protocol_id", "calendar_id", "summary", "files", "participants", "projects"],
      }),
    );
    await ensureFile(
      this.vault,
      this.peopleBaseFile,
      renderBaseYaml({
        name: "Люди",
        inFolder: this.peopleDir,
        order: [
          "display_name",
          "first_name",
          "last_name",
          "middle_name",
          "nick_name",
          "gender",
          "birthday",
          "emails",
          "phones",
          "companies",
          "positions",
          "person_id",
          "photo",
          "voiceprint",
        ],
      }),
    );
    await ensureFile(
      this.vault,
      this.projectsBaseFile,
      renderBaseYaml({
        name: "Проекты",
        inFolder: this.projectsDir,
        order: ["project_id", "title", "status", "owner", "tags", "protocols"],
      }),
    );
  }

  /**
   * Обновить `file.inFolder("...")` в существующих `.base`, если изменились папки карточек в настройках.
   *
   * Семантика: аккуратно меняем только `file.inFolder("...")` (во всех views),
   * не трогая остальные поля (columns/views/formulas и т.п.).
   */
  async syncBaseInFoldersToSettings(): Promise<void> {
    await this.syncOneBaseInFolder(this.meetingsBaseFile, this.meetingsDir);
    await this.syncOneBaseInFolder(this.protocolsBaseFile, this.protocolsDir);
    await this.syncOneBaseInFolder(this.peopleBaseFile, this.peopleDir);
    await this.syncOneBaseInFolder(this.projectsBaseFile, this.projectsDir);
  }

  private async syncOneBaseInFolder(basePath: string, dir: string): Promise<void> {
    const af = this.vault.getAbstractFileByPath(basePath);
    if (!af) return;
    if (!isTFile(af)) return;

    const cur = await this.vault.read(af);
    const next = replaceAllInFolder(cur, dir);
    if (next !== cur) await this.vault.modify(af, next);
  }
}

function renderBaseYaml(params: { name: string; inFolder: string; order: string[] }): string {
  // Формат `.base` — YAML для встроенного плагина Obsidian “Базы данных / Bases”.
  // Мы создаём минимальный “table view” с фильтром по папке карточек.
  // Пользователь может дальше расширять views/filters вручную.
  const orderLines = params.order.map((k) => `      - ${k}`).join("\n");
  return [
    "views:",
    "  - type: table",
    `    name: ${params.name}`,
    "    filters:",
    "      and:",
    `        - file.inFolder("${params.inFolder}")`,
    "    order:",
    orderLines,
    "",
  ].join("\n");
}

function replaceAllInFolder(baseYaml: string, folder: string): string {
  // Меняем все встреченные `file.inFolder("...")` на актуальную папку карточек.
  return String(baseYaml ?? "").replace(/file\.inFolder\("([^"]*)"\)/g, `file.inFolder("${folder}")`);
}
