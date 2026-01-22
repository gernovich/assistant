import type { App, TFile, Vault } from "obsidian";
import { normalizePath } from "obsidian";
import { ensureFolder } from "../vault/ensureFolder";
import { revealOrOpenInNewLeaf } from "../vault/revealOrOpenFile";
import { createUniqueMarkdownFile, sanitizeFileName } from "../vault/fileNaming";
import { yamlEscape } from "../domain/policies/yamlEscape";
import { FM } from "../domain/policies/frontmatterKeys";
import { makePseudoRandomId } from "../domain/policies/pseudoRandomId";
import { renderProjectCardMarkdown } from "../domain/policies/projectNoteTemplate";
import type { ProjectRepository } from "../application/contracts/projectRepository";

/**
 * Сервис карточек проектов (md-файлы в vault).
 *
 * Карточки проектов — ручная сущность: создаём шаблон и открываем файл,
 * дальше пользователь заполняет поля.
 */
export class ProjectNoteService implements ProjectRepository {
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
    const id = makePseudoRandomId({ prefix: "project", nowMs: Date.now(), randomHex: Math.random().toString(16).slice(2) });
    const file = await createUniqueMarkdownFile(
      this.vault,
      this.projectsDir,
      name,
      renderProjectCardMarkdown({
        id,
        title,
        keys: { assistantType: FM.assistantType, projectId: FM.projectId, owner: FM.owner, tags: FM.tags, protocols: FM.protocols },
        escape: yamlEscape,
      }),
    );
    await revealOrOpenInNewLeaf(this.app, file);
    return file;
  }
}

/**
 * Back-compat: оставить публичный шаблон для тестов/вызовов.
 * Внутри делегирует в domain policy.
 */
export function renderProjectCard(params: { title: string }): string {
  const id = makePseudoRandomId({ prefix: "project", nowMs: Date.now(), randomHex: Math.random().toString(16).slice(2) });
  return renderProjectCardMarkdown({
    id,
    title: params.title,
    keys: { assistantType: FM.assistantType, projectId: FM.projectId, owner: FM.owner, tags: FM.tags, protocols: FM.protocols },
    escape: yamlEscape,
  });
}
