import type { WindowTransport, TransportMessage, Unsubscribe } from "./windowTransport";

export class MockTransport implements WindowTransport {
  private listeners = new Set<(payload: TransportMessage) => void>();
  private peer: MockTransport | null = null;

  static pair(): { a: MockTransport; b: MockTransport } {
    const a = new MockTransport();
    const b = new MockTransport();
    a.peer = b;
    b.peer = a;
    return { a, b };
  }

  attach(): void {
    // заглушка: ничего не делаем
  }

  onReady(cb: () => void): Unsubscribe {
    cb();
    return () => undefined;
  }

  isReady(): boolean {
    return true;
  }

  send(payload: TransportMessage): void {
    this.peer?.emit(payload);
  }

  onMessage(cb: (payload: TransportMessage) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  close(): void {
    this.listeners.clear();
    this.peer = null;
  }

  getConfig(): null {
    return null;
  }

  getCspConnectSrc(): string[] | null {
    return null;
  }

  private emit(payload: TransportMessage): void {
    for (const cb of this.listeners) {
      cb(payload);
    }
  }
}
