import type { App, TFile, Vault } from "obsidian";
import { normalizePath } from "obsidian";
import { ensureFolder } from "../vault/ensureFolder";
import { revealOrOpenInNewLeaf } from "../vault/revealOrOpenFile";
import { createUniqueMarkdownFile, sanitizeFileName } from "../vault/fileNaming";
import { yamlEscape } from "../domain/policies/yamlEscape";
import { FM } from "../domain/policies/frontmatterKeys";
import { makePersonIdFromEmail } from "../ids/stableIds";
import { normalizeEmail } from "../domain/policies/normalizeEmail";
import { makePseudoRandomId } from "../domain/policies/pseudoRandomId";
import { renderPersonCardMarkdown } from "../domain/policies/personNoteTemplate";
import type { PersonRepository } from "../application/contracts/personRepository";
import { PersonIndex } from "./personIndex";
import { personCardBaseName } from "../domain/policies/personCardNaming";
import { parseJsonStringArray } from "../domain/policies/frontmatterJsonArrays";
import { parseFrontmatterMap, splitFrontmatter } from "../domain/policies/frontmatter";

/**
 * Сервис карточек людей (md-файлы в vault).
 *
 * Карточки людей — ручная сущность: создаём шаблон и открываем файл,
 * дальше пользователь заполняет поля (и/или позже мы начнём автозаполнение из календаря).
 */
export class PersonNoteService implements PersonRepository {
  private app: App;
  private vault: Vault;
  private peopleDir: string;
  private personIndex: PersonIndex;

  /** @param peopleDir Папка людей в vault. */
  constructor(app: App, peopleDir: string) {
    this.app = app;
    this.vault = app.vault;
    this.peopleDir = normalizePath(peopleDir);
    this.personIndex = new PersonIndex({ vault: app.vault as any, metadataCache: app.metadataCache as any });
  }

  /** Обновить папку людей (например после изменения настроек). */
  setPeopleDir(peopleDir: string): void {
    this.peopleDir = normalizePath(peopleDir);
  }

  /** Создать новую карточку человека (шаблон) и открыть её. */
  async createAndOpen(params?: { displayName?: string }): Promise<TFile> {
    await ensureFolder(this.vault, this.peopleDir);
    const name = sanitizeFileName(personCardBaseName({ displayName: params?.displayName }));
    const file = await createUniqueMarkdownFile(
      this.vault,
      this.peopleDir,
      name,
      renderPersonCardMarkdown({
        id: makePseudoRandomId({ prefix: "person", nowMs: Date.now(), randomHex: Math.random().toString(16).slice(2) }),
        displayName: params?.displayName ?? "",
        keys: {
          assistantType: FM.assistantType,
          personId: FM.personId,
          displayName: FM.displayName,
          firstName: FM.firstName,
          lastName: FM.lastName,
          middleName: FM.middleName,
          nickName: FM.nickName,
          gender: FM.gender,
          photo: FM.photo,
          birthday: FM.birthday,
          voiceprint: FM.voiceprint,
          emails: FM.emails,
          phones: FM.phones,
          companies: FM.companies,
          positions: FM.positions,
          mailboxes: FM.mailboxes,
          messengers: FM.messengers,
        },
        escape: yamlEscape,
      }),
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
    if (!email) return await Promise.reject("Некорректный email");

    await ensureFolder(this.vault, this.peopleDir);
    const existing = this.personIndex.findByEmail({ peopleRoot: this.peopleDir, email });
    if (existing && (existing as any).path) return existing as any;

    // Fallback: если metadataCache ещё не прогрелся, PersonIndex может не увидеть emails.
    // Тогда делаем “медленный” async scan: читаем frontmatter из файлов и ищем email там.
    const viaRead = await this.findExistingByEmailFallback({ email });
    if (viaRead) return viaRead;

    const baseName = sanitizeFileName(personCardBaseName({ displayName: params.displayName, email }));
    const file = await createUniqueMarkdownFile(
      this.vault,
      this.peopleDir,
      baseName,
      renderPersonCardMarkdown({
        id: makePersonIdFromEmail(email),
        displayName: params.displayName ?? "",
        email,
        keys: {
          assistantType: FM.assistantType,
          personId: FM.personId,
          displayName: FM.displayName,
          firstName: FM.firstName,
          lastName: FM.lastName,
          middleName: FM.middleName,
          nickName: FM.nickName,
          gender: FM.gender,
          photo: FM.photo,
          birthday: FM.birthday,
          voiceprint: FM.voiceprint,
          emails: FM.emails,
          phones: FM.phones,
          companies: FM.companies,
          positions: FM.positions,
          mailboxes: FM.mailboxes,
          messengers: FM.messengers,
        },
        escape: yamlEscape,
      }),
    );
    return file;
  }

  private async findExistingByEmailFallback(params: { email: string }): Promise<TFile | null> {
    const email = normalizeEmail(params.email);
    if (!email) return null;

    const prefix = this.peopleDir ? `${this.peopleDir.replace(/\/+$/g, "")}/` : "";
    const files = this.vault.getMarkdownFiles() as any[];
    for (const f of files) {
      if (!f || typeof f.path !== "string") continue;
      if (prefix && !String(f.path).startsWith(prefix)) continue;
      try {
        const md = await this.vault.read(f);
        const { frontmatter } = splitFrontmatter(md);
        if (!frontmatter) continue;
        const map = parseFrontmatterMap(frontmatter);
        const raw = String(map[FM.emails] ?? "").trim();
        const emails = raw ? parseJsonStringArray(raw) : [];
        const anyMatch = emails.some((x) => normalizeEmail(String(x)) === email);
        if (anyMatch) return f as TFile;
      } catch {
        // ignore read/parse errors for index fallback
      }
    }
    return null;
  }
}

export function renderPersonCard(params: { displayName: string; email?: string }): string {
  const id = params.email
    ? makePersonIdFromEmail(params.email)
    : makePseudoRandomId({ prefix: "person", nowMs: Date.now(), randomHex: Math.random().toString(16).slice(2) });
  return renderPersonCardMarkdown({
    id,
    displayName: params.displayName,
    email: params.email,
    keys: {
      assistantType: FM.assistantType,
      personId: FM.personId,
      displayName: FM.displayName,
      firstName: FM.firstName,
      lastName: FM.lastName,
      middleName: FM.middleName,
      nickName: FM.nickName,
      gender: FM.gender,
      photo: FM.photo,
      birthday: FM.birthday,
      voiceprint: FM.voiceprint,
      emails: FM.emails,
      phones: FM.phones,
      companies: FM.companies,
      positions: FM.positions,
      mailboxes: FM.mailboxes,
      messengers: FM.messengers,
    },
    escape: yamlEscape,
  });
}

// normalizeEmail/renderPersonCardMarkdown вынесены в domain/policies
