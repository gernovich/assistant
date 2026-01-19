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
