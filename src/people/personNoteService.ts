import type { App, TFile, Vault } from "obsidian";
import { normalizePath } from "obsidian";
import { ensureFolder } from "../vault/ensureFolder";
import { revealOrOpenInNewLeaf } from "../vault/revealOrOpenFile";
import { createUniqueMarkdownFile, sanitizeFileName } from "../vault/fileNaming";
import { yamlEscape } from "../vault/yamlEscape";
import { FM } from "../vault/frontmatterKeys";
import { makePersonIdFromEmail } from "../ids/stableIds";

/**
 * Сервис карточек людей (md-файлы в vault).
 *
 * Карточки людей — ручная сущность: создаём шаблон и открываем файл,
 * дальше пользователь заполняет поля (и/или позже мы начнём автозаполнение из календаря).
 */
export class PersonNoteService {
  private app: App;
  private vault: Vault;
  private peopleDir: string;

  /** @param peopleDir Папка людей в vault. */
  constructor(app: App, peopleDir: string) {
    this.app = app;
    this.vault = app.vault;
    this.peopleDir = normalizePath(peopleDir);
  }

  /** Обновить папку людей (например после изменения настроек). */
  setPeopleDir(peopleDir: string): void {
    this.peopleDir = normalizePath(peopleDir);
  }

  /** Создать новую карточку человека (шаблон) и открыть её. */
  async createAndOpen(params?: { displayName?: string }): Promise<TFile> {
    await ensureFolder(this.vault, this.peopleDir);
    const name = sanitizeFileName(params?.displayName ?? "Новый человек");
    const file = await createUniqueMarkdownFile(
      this.vault,
      this.peopleDir,
      name,
      renderPersonCard({ displayName: params?.displayName ?? "" }),
    );
    await revealOrOpenInNewLeaf(this.app, file);
    return file;
  }

  /**
   * Найти (по email) или создать карточку человека.
   *
   * Используем для “извлечения участников встречи в карточки”.
   */
  async ensureByEmail(params: { email: string; displayName?: string }): Promise<TFile> {
    const email = normalizeEmail(params.email);
    if (!email) throw new Error("Некорректный email");

    await ensureFolder(this.vault, this.peopleDir);
    const existing = this.findByEmail(email);
    if (existing) return existing;

    const baseName = sanitizeFileName(params.displayName?.trim() || email.split("@")[0] || email);
    const file = await createUniqueMarkdownFile(
      this.vault,
      this.peopleDir,
      baseName,
      renderPersonCard({ displayName: params.displayName ?? "", email }),
    );
    return file;
  }

  private findByEmail(email: string): TFile | null {
    const dirPrefix = normalizePath(this.peopleDir) + "/";
    const files = this.vault.getFiles();
    for (const f of files) {
      if (!f.path.startsWith(dirPrefix)) continue;
      const cache = this.app.metadataCache.getFileCache(f);
      const fm = cache?.frontmatter as Record<string, unknown> | undefined;
      const emails = Array.isArray(fm?.[FM.emails])
        ? (fm?.[FM.emails] as unknown[]).filter((x) => typeof x === "string")
        : [];
      const anyMatch = emails.some((x) => normalizeEmail(String(x)) === email);
      if (anyMatch) return f;
    }
    return null;
  }
}

export function renderPersonCard(params: { displayName: string; email?: string }): string {
  const id = params.email ? makePersonIdFromEmail(params.email) : makePersonId();
  return [
    "---",
    `${FM.assistantType}: person`,
    `${FM.personId}: ${yamlEscape(id)}`,
    `${FM.displayName}: ${yamlEscape(params.displayName)}`,
    `${FM.firstName}: `,
    `${FM.lastName}: `,
    `${FM.middleName}: `,
    `${FM.nickName}: `,
    `${FM.gender}: `,
    `${FM.photo}: `,
    `${FM.birthday}: `,
    `${FM.voiceprint}: `,
    `${FM.emails}: ${params.email ? `[${yamlEscape(params.email)}]` : "[]"}`,
    `${FM.phones}: []`,
    `${FM.companies}: []`,
    `${FM.positions}: []`,
    `${FM.mailboxes}: []`,
    `${FM.messengers}: []`,
    "---",
    "",
    `## ${params.displayName ? params.displayName : "Новый человек"}`,
    "",
    "### Контакты",
    "",
    "- Email: ",
    "- Телефон: ",
    "- Мессенджеры: ",
    "",
    "### Досье",
    "",
    "- (пока пусто)",
    "",
    "### Факты",
    "",
    "- (пока пусто)",
    "",
    "### Связи",
    "",
    "- Проекты: ",
    "- Встречи: ",
    "",
  ].join("\n");
}

function makePersonId(): string {
  return `person-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

function normalizeEmail(v: string): string {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  const m = s.match(/^mailto:(.+)$/i);
  return (m ? m[1] : s).trim().toLowerCase();
}
