import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type { LogEntry } from "../log/logService";
import type { LogService } from "../log/logService";

export const LOG_VIEW_TYPE = "assistant-log";

export class LogView extends ItemView {
  private log: LogService;
  private openTodayFile?: () => void;
  private openAgenda?: () => void;
  private unsubscribe?: () => void;

  constructor(
    leaf: WorkspaceLeaf,
    log: LogService,
    openTodayFile?: () => void,
    openAgenda?: () => void,
  ) {
    super(leaf);
    this.log = log;
    this.openTodayFile = openTodayFile;
    this.openAgenda = openAgenda;
  }

  getViewType(): string {
    return LOG_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Лог";
  }

  getIcon(): string {
    return "list";
  }

  async onOpen() {
    const action = this.addAction("calendar", "Открыть повестку", () => this.openAgenda?.());
    const force = () => {
      try {
        setIcon(action, "calendar");
      } catch {
        // ignore
      }
    };
    force();
    requestAnimationFrame(force);
    this.unsubscribe = this.log.onChange(() => this.render());
    this.render();
  }

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
    const clearBtn = actions.createEl("button", { text: "Очистить" });
    clearBtn.onclick = () => this.log.clear();

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

