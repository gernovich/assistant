import { Setting } from "obsidian";

/** Google CalDAV v2: serverUrl должен быть корнем /caldav/v2/ (без email). */
export const GOOGLE_CALDAV_SERVER_URL = "https://apidata.googleusercontent.com/caldav/v2/";

export type SettingsNoticeVariant = "info" | "warning" | "ok" | "danger";

/** Быстро проверить, что URL похож на Google CalDAV. */
export function isGoogleCaldavUrl(url: string): boolean {
  const u = (url ?? "").trim();
  if (!u) return false;
  return u.includes("apidata.googleusercontent.com/caldav/v2");
}

/**
 * UI: унифицированный “notice” блок для настроек.
 * Зачем: секции настроек не должны копипастить `createDiv({cls: ...})` и имена классов.
 */
export function createSettingsNotice(params: {
  containerEl: HTMLElement;
  variant: SettingsNoticeVariant;
  title: string;
  desc?: string;
}): HTMLDivElement {
  const el = params.containerEl.createDiv({ cls: `assistant-settings__notice assistant-settings__notice--${params.variant}` });
  el.createDiv({ text: params.title, cls: "assistant-settings__notice-title" });
  if (params.desc) el.createDiv({ text: params.desc, cls: "assistant-settings__notice-desc" });
  return el;
}

/**
 * Добавить строку описания внутрь notice (тот же стиль, что и `desc`).
 * Зачем: в некоторых notice нужно несколько абзацев (например ссылки + шаги).
 */
export function noticeAddDescLine(noticeEl: HTMLElement, text: string): HTMLDivElement {
  return noticeEl.createDiv({ text, cls: "assistant-settings__notice-desc" });
}

/** Добавить маркированный список внутри notice. */
export function noticeAddList(noticeEl: HTMLElement, items: string[]): HTMLUListElement {
  const ul = noticeEl.createEl("ul");
  for (const t of items) ul.createEl("li", { text: t });
  return ul;
}

/** Добавить нумерованный список внутри notice. */
export function noticeAddOrderedList(noticeEl: HTMLElement, items: string[]): HTMLOListElement {
  const ol = noticeEl.createEl("ol");
  for (const t of items) ol.createEl("li", { text: t });
  return ol;
}

/** Добавить список ссылок внутри notice (маркированный). */
export function noticeAddLinks(noticeEl: HTMLElement, links: Array<{ text: string; href: string }>): HTMLUListElement {
  const ul = noticeEl.createEl("ul");
  for (const l of links) {
    ul.createEl("li").createEl("a", { text: l.text, href: l.href });
  }
  return ul;
}

/** Показать Obsidian Notice (используем require, чтобы не тащить Notice в bundle статически). */
export function showNotice(message: string): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Notice } = require("obsidian") as typeof import("obsidian");
  new Notice(message);
}

/**
 * UI: поле “секрет/пароль” с кнопкой “глазик”.
 * Зачем: единый UX для пароля CalDAV и clientSecret Google OAuth.
 */
export function addPasswordSettingWithEye(params: {
  containerEl: HTMLElement;
  name: string;
  desc?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => Promise<void> | void;
  tooltip?: string;
}): Setting {
  let inputEl: HTMLInputElement | null = null;
  let visible = false;

  const s = new Setting(params.containerEl).setName(params.name);
  if (params.desc) s.setDesc(params.desc);

  s.addText((t) => {
    inputEl = t.inputEl;
    t.inputEl.type = "password";
    t.setPlaceholder(params.placeholder ?? "••••••••")
      .setValue(params.value)
      .onChange(async (v) => {
        await params.onChange(v);
      });
  });

  s.addExtraButton((b) => {
    b.setIcon("eye").setTooltip(params.tooltip ?? "Показать/скрыть");
    b.onClick(() => {
      visible = !visible;
      if (inputEl) inputEl.type = visible ? "text" : "password";
      b.setIcon(visible ? "eye-off" : "eye");
    });
  });

  return s;
}

/** Сгенерировать id для настроек (UUID если доступен). */
export function newId(prefix = "cal"): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyCrypto = crypto as any;
  if (anyCrypto?.randomUUID) return anyCrypto.randomUUID();
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
