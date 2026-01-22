// Minimal Obsidian API stub for unit tests (Vitest).

export class Notice {
  static messages: string[] = [];

  constructor(message: string) {
    Notice.messages.push(message);
  }
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

/**
 * Минимальный stub для `requestUrl`, чтобы можно было тестировать код, который строит запрос.
 * В unit-тестах можно заменить реализацию через `vi.spyOn` или передавать такие URL, которые не вызывают сеть.
 */
export async function requestUrl(_req: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer;
  throw?: boolean;
}): Promise<{ status: number; headers: Record<string, string>; text?: string; arrayBuffer: ArrayBuffer }> {
  throw new Error("requestUrl: stub — используйте vi.spyOn для подмены в тестах");
}

// ---- Workspace/View stubs (нужно для импорта views в unit-тестах) ----

export type WorkspaceLeaf = {
  view?: unknown;
  setViewState?: (state: unknown) => Promise<void>;
};

export class ItemView {
  // В Obsidian ItemView принимает leaf и имеет contentEl для рендера.
  leaf: WorkspaceLeaf;
  contentEl: HTMLElement;

  constructor(leaf: WorkspaceLeaf) {
    this.leaf = leaf;
    this.contentEl = globalThis.document?.createElement?.("div") ?? ({} as any);
  }

  getViewType(): string {
    return "stub-view";
  }
  getDisplayText(): string {
    return "stub";
  }
  getIcon(): string {
    return "";
  }

  // Методы, которые используют views
  addAction(_icon: string, _title: string, _callback: () => void): HTMLElement {
    return globalThis.document?.createElement?.("div") ?? ({} as any);
  }

  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}
}
