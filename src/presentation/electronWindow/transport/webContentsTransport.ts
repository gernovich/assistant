import { WindowTransport, TransportAttachTarget } from "./windowTransport";

type WebContentsLike = {
  send(channel: string, ...args: unknown[]): void;
};

type IpcRendererLike = {
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): void;
};

export class WebContentsTransport implements WindowTransport {
  private messageCallbacks: Set<(data: unknown) => void> = new Set();
  private readyCallbacks: Set<() => void> = new Set();
  private _isReady = false;
  private unsubscribeMap = new Map<(data: unknown) => void, () => void>();

  constructor(
    private params: {
      webContents?: WebContentsLike;
      ipcRenderer?: IpcRendererLike;
      channelToDialog?: string;
      channelFromDialog?: string;
      hostId?: number;
    } = {},
  ) {}

  attach(params?: TransportAttachTarget): void {
    if (this._isReady) return;
    const target = params?.target as
      | {
          webContents?: WebContentsLike;
          ipcRenderer?: IpcRendererLike;
          channelToDialog?: string;
          channelFromDialog?: string;
        }
      | undefined;
    if (target) {
      this.params = { ...this.params, ...target };
    }
    if (!this.params.webContents || !this.params.ipcRenderer) {
      console.warn("[WebContentsTransport] attach without webContents/ipcRenderer.");
      return;
    }
    this._isReady = true;
    for (const cb of this.readyCallbacks) {
      try {
        cb();
      } catch (e) {
        console.error("[WebContentsTransport] Error in ready callback:", e);
      }
    }
  }

  send(payload: unknown): void {
    if (!this._isReady) {
      console.warn("[WebContentsTransport] Attempted to send when not ready.");
      return;
    }
    const channel = this.params.channelToDialog ?? "assistant/test/message";
    this.params.webContents.send(channel, payload);
  }

  onMessage(cb: (data: unknown) => void): () => void {
    this.messageCallbacks.add(cb);
    const handler = (_event: unknown, payload: unknown) => {
      try {
        cb(payload);
      } catch (e) {
        console.error("[WebContentsTransport] Error in message callback:", e);
      }
    };
    const channel = this.params.channelFromDialog ?? "assistant/test/action";
    this.params.ipcRenderer.on(channel, handler);
    const unsubscribe = () => {
      this.params.ipcRenderer?.removeListener(channel, handler);
      this.messageCallbacks.delete(cb);
      this.unsubscribeMap.delete(cb);
    };
    this.unsubscribeMap.set(cb, unsubscribe);
    return unsubscribe;
  }

  onReady(cb: () => void): () => void {
    this.readyCallbacks.add(cb);
    if (this._isReady) {
      cb();
    }
    return () => this.readyCallbacks.delete(cb);
  }

  isReady(): boolean {
    return this._isReady;
  }

  close(): void {
    this._isReady = false;
    this.messageCallbacks.clear();
    for (const unsub of this.unsubscribeMap.values()) {
      try {
        unsub();
      } catch {
        // ignore
      }
    }
    this.unsubscribeMap.clear();
    this.readyCallbacks.clear();
  }

  getConfig(): { type: "webContents"; hostId: number; channelToDialog?: string; channelFromDialog?: string } | null {
    const hostId = Number(this.params.hostId ?? 0);
    if (!Number.isFinite(hostId) || hostId <= 0) return null;
    return {
      type: "webContents",
      hostId,
      channelToDialog: this.params.channelToDialog,
      channelFromDialog: this.params.channelFromDialog,
    };
  }
}
