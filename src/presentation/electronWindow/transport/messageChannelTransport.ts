import type { WindowTransport, TransportMessage, Unsubscribe, TransportAttachTarget } from "./windowTransport";

type MessageChannelMainLike = new () => { port1: any; port2: any };

export class MessageChannelTransport implements WindowTransport {
  private channelName: string;
  private readonly port1: any;
  private readonly port2: any;
  private webContents: any;
  private ready = false;
  private waiters = new Set<() => void>();
  private pending: TransportMessage[] = [];

  constructor(params: { messageChannelMain: MessageChannelMainLike; webContents?: any; channelName?: string }) {
    const { messageChannelMain, webContents, channelName } = params;
    this.channelName = channelName ?? "assistant/message-channel-port";
    this.webContents = webContents;
    const channel = new messageChannelMain();
    this.port1 = channel.port1;
    this.port2 = channel.port2;
    this.port1.start?.();
  }

  attach(params?: TransportAttachTarget): void {
    const target = params?.target as { webContents?: any; channelName?: string } | undefined;
    if (target?.webContents) {
      this.webContents = target.webContents;
    }
    if (target?.channelName) {
      this.channelName = target.channelName;
    }
    if (!this.webContents || typeof this.webContents.postMessage !== "function") return;
    this.webContents.once("did-finish-load", () => {
      try {
        this.webContents.postMessage(this.channelName, null, [this.port2]);
        this.ready = true;
        if (this.pending.length > 0) {
          const toFlush = this.pending;
          this.pending = [];
          for (const payload of toFlush) {
            try {
              this.port1.postMessage(payload);
            } catch {
              // ignore
            }
          }
        }
        for (const cb of this.waiters) {
          try {
            cb();
          } catch {
            // ignore
          }
        }
      } catch {
        this.ready = false;
      }
    });
  }

  isReady(): boolean {
    return this.ready;
  }

  send(payload: TransportMessage): void {
    if (!this.ready) {
      this.pending.push(payload);
      return;
    }
    try {
      this.port1.postMessage(payload);
    } catch {
      // ignore
    }
  }

  onMessage(cb: (payload: TransportMessage) => void): Unsubscribe {
    const handler = (event: any) => cb(event?.data);
    this.port1.on?.("message", handler);
    return () => {
      try {
        this.port1.removeListener?.("message", handler);
      } catch {
        // ignore
      }
    };
  }

  onReady(cb: () => void): Unsubscribe {
    if (this.ready) {
      cb();
      return () => undefined;
    }
    this.waiters.add(cb);
    return () => {
      this.waiters.delete(cb);
    };
  }

  close(): void {
    try {
      this.port1.close?.();
    } catch {
      // ignore
    }
  }

  getConfig(): { type: "messageChannel"; channel?: string } | null {
    return { type: "messageChannel", channel: this.channelName };
  }
}
