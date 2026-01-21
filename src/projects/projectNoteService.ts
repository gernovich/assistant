import type { App, TFile, Vault } from "obsidian";
import { normalizePath } from "obsidian";
import { ensureFolder } from "../vault/ensureFolder";
import { revealOrOpenInNewLeaf } from "../vault/revealOrOpenFile";
import { createUniqueMarkdownFile, sanitizeFileName } from "../vault/fileNaming";
import { yamlEscape } from "../vault/yamlEscape";
import { FM } from "../vault/frontmatterKeys";

/**
 * Сервис карточек проектов (md-файлы в vault).
 *
 * Карточки проектов — ручная сущность: создаём шаблон и открываем файл,
 * дальше пользователь заполняет поля.
 */
export class ProjectNoteService {
  private app: App;
  private vault: Vault;
  private projectsDir: string;

  /** @param projectsDir Папка проектов в vault. */
  constructor(app: App, projectsDir: string) {
    this.app = app;
    this.vault = app.vault;
    this.projectsDir = normalizePath(projectsDir);
  }

  /** Обновить папку проектов (например после изменения настроек). */
  setProjectsDir(projectsDir: string): void {
    this.projectsDir = normalizePath(projectsDir);
  }

  /** Создать новую карточку проекта (шаблон) и открыть её. */
  async createAndOpen(params?: { title?: string }): Promise<TFile> {
    await ensureFolder(this.vault, this.projectsDir);
    const title = params?.title ?? "Новый проект";
    const name = sanitizeFileName(title);
    const file = await createUniqueMarkdownFile(this.vault, this.projectsDir, name, renderProjectCard({ title }));
    await revealOrOpenInNewLeaf(this.app, file);
    return file;
  }
}

export function renderProjectCard(params: { title: string }): string {
  const id = makeProjectId();
  return [
    "---",
    `${FM.assistantType}: project`,
    `${FM.projectId}: ${yamlEscape(id)}`,
    `title: ${yamlEscape(params.title)}`,
    "status: ",
    `${FM.owner}:`,
    "  person_id: ",
    "  display_name: ",
    "  email: ",
    `${FM.tags}: []`,
    `${FM.protocols}: []`,
    "---",
    "",
    `## ${params.title ? params.title : "Новый проект"}`,
    "",
    "### Заметки",
    "",
    "- (пока пусто)",
    "",
    "### Обещания",
    "",
    "- (пока пусто)",
    "",
    "### Статусы",
    "",
    "- (пока пусто)",
    "",
    "### Описание",
    "",
    "- (пока пусто)",
    "",
    "### Цели / результаты",
    "",
    "- (пока пусто)",
    "",
    "### Связи",
    "",
    "- Люди: ",
    "- Встречи: ",
    "- Протоколы: ",
    "",
  ].join("\n");
}

function makeProjectId(): string {
  return `project-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}
