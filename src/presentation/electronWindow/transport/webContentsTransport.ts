import { WindowTransport, TransportAttachTarget } from "./windowTransport";

type WebContentsLike = {
  send(channel: string, ...args: unknown[]): void;
};

type IpcRendererLike = {
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): void;
};

/**
 * Транспорт на базе webContents.send + ipcRenderer.on.
 * Используется для связи основного окна и диалога через каналы.
 */
export class WebContentsTransport implements WindowTransport {
  /** Коллбеки входящих сообщений. */
  private messageCallbacks: Set<(data: unknown) => void> = new Set();
  /** Коллбеки готовности транспорта. */
  private readyCallbacks: Set<() => void> = new Set();
  /** Флаг готовности транспорта. */
  private _isReady = false;
  /** Карта отписок для слушателей. */
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

  /** Подключает транспорт к целевым объектам (webContents/ipcRenderer). */
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
      console.warn("[WebContentsTransport] подключение без webContents/ipcRenderer.");
      return;
    }
    this._isReady = true;
    for (const cb of this.readyCallbacks) {
      try {
        cb();
      } catch (e) {
        console.error("[WebContentsTransport] Ошибка в коллбеке готовности:", e);
      }
    }
  }

  /** Отправляет сообщение в канал диалога. */
  send(payload: unknown): void {
    if (!this._isReady) {
      console.warn("[WebContentsTransport] Попытка отправки до готовности.");
      return;
    }
    const channel = this.params.channelToDialog ?? "assistant/test/message";
    this.params.webContents.send(channel, payload);
  }

  /** Подписывается на входящие сообщения. */
  onMessage(cb: (data: unknown) => void): () => void {
    this.messageCallbacks.add(cb);
    const handler = (_event: unknown, payload: unknown) => {
      try {
        cb(payload);
      } catch (e) {
        console.error("[WebContentsTransport] Ошибка в коллбеке сообщения:", e);
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

  /** Освобождает ресурсы транспорта. */
  close(): void {
    this._isReady = false;
    this.messageCallbacks.clear();
    for (const unsub of this.unsubscribeMap.values()) {
      try {
        unsub();
      } catch {
        // Игнорируем ошибки при отписке.
      }
    }
    this.unsubscribeMap.clear();
    this.readyCallbacks.clear();
  }

  /** Возвращает конфигурацию для инициализации транспорта в preload. */
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
