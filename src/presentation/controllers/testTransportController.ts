export type TestTransportEntry = {
  id: string;
  ts: number;
  direction: "app->dialog" | "dialog->app" | "system";
  message: string;
  data?: unknown;
};

export class TestTransportLog {
  private items: TestTransportEntry[] = [];
  private listeners = new Set<() => void>();

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  list(): TestTransportEntry[] {
    return this.items.slice().reverse();
  }

  clear(): void {
    this.items = [];
    this.emit();
  }

  push(entry: TestTransportEntry): void {
    this.items.push(entry);
    if (this.items.length > 500) {
      this.items = this.items.slice(-500);
    }
    this.emit();
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}

export type TestTransportController = {
  onChange: (cb: () => void) => () => void;
  list: () => TestTransportEntry[];
  clear: () => void;
  openDialog: () => void;
  sendMessage: (message: string) => void;
};

export class DefaultTestTransportController implements TestTransportController {
  constructor(
    private deps: {
      log: TestTransportLog;
      openDialog: () => void;
      sendMessage: (message: string) => void;
    },
  ) {}

  onChange(cb: () => void): () => void {
    return this.deps.log.onChange(cb);
  }

  list(): TestTransportEntry[] {
    return this.deps.log.list();
  }

  clear(): void {
    this.deps.log.clear();
  }

  openDialog(): void {
    this.deps.openDialog();
  }

  sendMessage(message: string): void {
    this.deps.log.push({
      id: `test_transport_${Date.now()}`,
      ts: Date.now(),
      direction: "system",
      message: "test_transport_app_click",
      data: { message },
    });
    this.deps.sendMessage(message);
  }
}
