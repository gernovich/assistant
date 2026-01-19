import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type { LogEntry } from "../log/logService";
import type { LogService } from "../log/logService";

/** Тип Obsidian view для панели лога ассистента. */
export const LOG_VIEW_TYPE = "assistant-log";

/** View “Лог” — отображает in-memory лог и даёт быстрые действия (открыть файл/очистить). */
export class LogView extends ItemView {
  private log: LogService;
  private openTodayFile?: () => void;
  private clearTodayFile?: () => void;
  private openAgenda?: () => void;
  private unsubscribe?: () => void;

  /**
   * @param leaf Leaf, в котором живёт view.
   * @param log Лог-сервис (источник записей).
   * @param openTodayFile Открыть файл лога за сегодня (в системной папке плагина).
   * @param clearTodayFile Очистить файл лога за сегодня.
   * @param openAgenda Открыть повестку.
   */
  constructor(leaf: WorkspaceLeaf, log: LogService, openTodayFile?: () => void, clearTodayFile?: () => void, openAgenda?: () => void) {
    super(leaf);
    this.log = log;
    this.openTodayFile = openTodayFile;
    this.clearTodayFile = clearTodayFile;
    this.openAgenda = openAgenda;
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
    const action = this.addAction("calendar", "Открыть повестку", () => this.openAgenda?.());
    const force = () => {
      try {
        setIcon(action, "calendar");
      } catch {
        // игнорируем
      }
    };
    force();
    requestAnimationFrame(force);
    this.unsubscribe = this.log.onChange(() => this.render());
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
    openBtn.onclick = () => this.openTodayFile?.();

    const clearPanelBtn = actions.createEl("button", { text: "Очистить панель" });
    clearPanelBtn.onclick = () => this.log.clear();

    const clearFileBtn = actions.createEl("button", { text: "Очистить файл (сегодня)" });
    clearFileBtn.onclick = () => this.clearTodayFile?.();

    const list = el.createDiv({ cls: "assistant-log__list" });
    const items = this.log.list();
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
  const row = document.createElement("div");
  row.className = `assistant-log__row assistant-log__row--${e.level}`;

  const ts = document.createElement("div");
  ts.className = "assistant-log__ts";
  ts.textContent = new Date(e.ts).toLocaleString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const msg = document.createElement("div");
  msg.className = "assistant-log__msg";
  msg.textContent = e.message;

  row.appendChild(ts);
  row.appendChild(msg);

  if (e.data && Object.keys(e.data).length > 0) {
    const pre = document.createElement("pre");
    pre.className = "assistant-log__data";
    try {
      pre.textContent = JSON.stringify(e.data, null, 2);
    } catch {
      pre.textContent = String(e.data);
    }
    row.appendChild(pre);
  }

  return row;
}
