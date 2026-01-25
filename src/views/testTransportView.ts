import { ItemView, WorkspaceLeaf } from "obsidian";
import type { TestTransportController, TestTransportEntry } from "../presentation/controllers/testTransportController";

export const TEST_TRANSPORT_VIEW_TYPE = "test_transport_panel";

export class TestTransportView extends ItemView {
  private controller: TestTransportController;
  private unsubscribe?: () => void;

  constructor(leaf: WorkspaceLeaf, controller: TestTransportController) {
    super(leaf);
    this.controller = controller;
  }

  getViewType(): string {
    return TEST_TRANSPORT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Test window transport";
  }

  getIcon(): string {
    return "flask-conical";
  }

  async onOpen() {
    this.unsubscribe = this.controller.onChange(() => this.render());
    this.render();
  }

  async onClose() {
    this.unsubscribe?.();
  }

  private render() {
    const el = this.contentEl;
    el.empty();
    el.addClass("test_transport_panel");

    const header = el.createDiv({ cls: "test_transport_header" });
    header.createDiv({ text: "Test window transport", cls: "test_transport_title" });

    const actions = header.createDiv({ cls: "test_transport_actions" });
    const openBtn = actions.createEl("button", { text: "Open dialog" });
    openBtn.onclick = () => this.controller.openDialog();
    const clearBtn = actions.createEl("button", { text: "Clear" });
    clearBtn.onclick = () => this.controller.clear();

    const buttons = el.createDiv({ cls: "test_transport_buttons" });
    const appOneBtn = buttons.createEl("button", { text: "App one" });
    appOneBtn.onclick = () => this.controller.sendMessage("App one");
    const appTwoBtn = buttons.createEl("button", { text: "App two" });
    appTwoBtn.onclick = () => this.controller.sendMessage("App two");
    const appThreeBtn = buttons.createEl("button", { text: "App three" });
    appThreeBtn.onclick = () => this.controller.sendMessage("App three");

    const list = el.createDiv({ cls: "test_transport_log" });
    const items = this.controller.list();
    if (items.length === 0) {
      list.createDiv({ text: "Пока пусто.", cls: "test_transport_empty" });
      return;
    }

    for (const entry of items) {
      list.appendChild(renderEntry(entry));
    }
  }
}

function renderEntry(e: TestTransportEntry): HTMLElement {
  const root = document.createElement("div");
  root.className = `test_transport_item test_transport_item--${e.direction.replace("->", "_")}`;

  const ts = document.createElement("span");
  ts.className = "test_transport_ts";
  ts.textContent = fmtTime(e.ts);

  const dir = document.createElement("span");
  dir.className = "test_transport_dir";
  dir.textContent = e.direction;

  const msg = document.createElement("span");
  msg.className = "test_transport_msg";
  msg.textContent = e.message;

  root.appendChild(ts);
  root.appendChild(dir);
  root.appendChild(msg);

  if (e.data !== undefined) {
    const span = document.createElement("span");
    span.className = "test_transport_data";
    try {
      span.textContent = JSON.stringify(e.data);
    } catch {
      span.textContent = String(e.data);
    }
    root.appendChild(span);
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
