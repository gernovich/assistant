import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type { LogEntry } from "../log/logService";
import type { LogController } from "../presentation/controllers/logController";

/** Тип Obsidian view для панели лога ассистента. */
export const LOG_VIEW_TYPE = "assistant-log";

/** View “Лог” — отображает in-memory лог и даёт быстрые действия (открыть файл/очистить). */
export class LogView extends ItemView {
  private controller: LogController;
  private unsubscribe?: () => void;

  /**
   * @param leaf Leaf, в котором живёт view.
   * @param controller Контроллер (порт) для LogView.
   */
  constructor(leaf: WorkspaceLeaf, controller: LogController) {
    super(leaf);
    this.controller = controller;
  }

  /** Obsidian: тип view. */
  getViewType(): string {
    return LOG_VIEW_TYPE;
  }

  /** Obsidian: заголовок вкладки. */
  getDisplayText(): string {
    return "Лог";
  }

  /** Obsidian: иконка вкладки. */
  getIcon(): string {
    return "list";
  }

  /** Obsidian: lifecycle — при открытии view подписываемся на лог и рендерим. */
  async onOpen() {
    const action = this.addAction("calendar", "Открыть повестку", () => void this.controller.openAgenda());
    const force = () => {
      try {
        setIcon(action, "calendar");
      } catch {
        // игнорируем
      }
    };
    force();
    requestAnimationFrame(force);
    this.unsubscribe = this.controller.onChange(() => this.render());
    this.render();
  }

  /** Obsidian: lifecycle — снимаем подписки. */
  async onClose() {
    this.unsubscribe?.();
  }

  private render() {
    const el = this.contentEl;
    el.empty();
    el.addClass("assistant-log");

    const header = el.createDiv({ cls: "assistant-log__header" });
    header.createDiv({ text: "Лог", cls: "assistant-log__title" });

    const actions = header.createDiv({ cls: "assistant-log__actions" });
    const openBtn = actions.createEl("button", { text: "Открыть файл" });
    openBtn.onclick = () => void this.controller.openTodayFile();

    const clearBtn = actions.createEl("button", { text: "Очистить лог" });
    clearBtn.onclick = () => void this.controller.clearAll();

    const list = el.createDiv({ cls: "assistant-log__list" });
    const items = this.controller.list();
    if (items.length === 0) {
      list.createDiv({ text: "Пока пусто.", cls: "assistant-log__empty" });
      return;
    }

    for (const entry of items) {
      list.appendChild(renderEntry(entry));
    }
  }
}

function renderEntry(e: LogEntry): HTMLElement {
  const hasData = Boolean(e.data && Object.keys(e.data).length > 0);
  const root = document.createElement(hasData ? "details" : "div");
  root.className = `assistant-log__item assistant-log__item--${e.level}`;
  if (hasData) (root as HTMLDetailsElement).open = false;

  const head = document.createElement(hasData ? "summary" : "div");
  head.className = "assistant-log__line";

  const ts = document.createElement("span");
  ts.className = "assistant-log__ts";
  ts.textContent = fmtTime(e.ts);
  ts.title = new Date(e.ts).toISOString();

  const lvl = document.createElement("span");
  lvl.className = `assistant-log__lvl assistant-log__lvl--${e.level}`;
  lvl.textContent = e.level.toUpperCase();

  const msg = document.createElement("span");
  msg.className = "assistant-log__msg";
  msg.textContent = e.message;

  head.appendChild(ts);
  head.appendChild(lvl);
  head.appendChild(msg);
  root.appendChild(head);

  if (hasData) {
    const pre = document.createElement("pre");
    pre.className = "assistant-log__data";
    try {
      pre.textContent = JSON.stringify(e.data, null, 2);
    } catch {
      pre.textContent = String(e.data);
    }
    root.appendChild(pre);
  }

  return root;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}
