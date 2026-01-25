import { WindowTransport, TransportAttachTarget } from "./windowTransport";
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "node:net";

type WebSocketLike = WebSocket;

export class WebSocketTransport implements WindowTransport {
  private wss: WebSocketServer | null = null;
  private socket: WebSocketLike | null = null;
  private messageCallbacks: Set<(data: unknown) => void> = new Set();
  private readyCallbacks: Set<() => void> = new Set();
  private _isReady = false;
  private sendQueue: string[] = [];
  private config: { type: "ws"; url: string } | null = null;

  constructor(
    private params: {
      host?: string;
      port: number;
      path?: string;
      maxQueue?: number;
    },
  ) {}

  attach(params?: TransportAttachTarget): void {
    if (this.wss) return;
    const target = params?.target;
    if (target?.type === "ws" && typeof target.url === "string") {
      try {
        const url = new URL(target.url);
        this.params = {
          ...this.params,
          host: url.hostname,
          port: Number(url.port) || this.params.port,
          path: url.pathname,
        };
      } catch {
        // ignore
      }
    }

    const { host, port, path } = this.params;
    this.wss = new WebSocketServer({ host, port, path });

    this.wss.on("connection", (ws) => {
      this.socket = ws;
      this.socket.on("message", (data) => {
        const payload = this.tryParse(data);
        for (const cb of this.messageCallbacks) {
          try {
            cb(payload);
          } catch (e) {
            console.error("[WebSocketTransport] Error in message callback:", e);
          }
        }
      });
      this.socket.on("close", () => {
        this.socket = null;
      });
      this.flushQueue();
    });

    this.wss.on("listening", () => {
      this._isReady = true;
      const addr = this.wss?.address() as AddressInfo | null;
      if (addr?.port) {
        const host = addr.address && addr.address !== "::" && addr.address !== "0.0.0.0" ? addr.address : "127.0.0.1";
        const path = this.params.path ?? "";
        this.config = { type: "ws", url: `ws://${host}:${addr.port}${path}` };
      }
      for (const cb of this.readyCallbacks) {
        try {
          cb();
        } catch (e) {
          console.error("[WebSocketTransport] Error in ready callback:", e);
        }
      }
      if (this.config?.url) {
        console.log(`[WebSocketTransport] listening on ${this.config.url}`);
      }
    });

    this.wss.on("error", (err) => {
      console.error("[WebSocketTransport] server error:", err);
    });
  }

  send(payload: unknown): void {
    if (!this._isReady) {
      console.warn("[WebSocketTransport] Attempted to send when not ready.");
      return;
    }
    const message = JSON.stringify(payload ?? null);
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.enqueue(message);
      return;
    }
    this.socket.send(message);
  }

  onMessage(cb: (data: unknown) => void): () => void {
    this.messageCallbacks.add(cb);
    return () => this.messageCallbacks.delete(cb);
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
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore
      }
      this.socket = null;
    }
    if (this.wss) {
      try {
        this.wss.close();
      } catch {
        // ignore
      }
      this.wss = null;
    }
    this._isReady = false;
    this.config = null;
    this.sendQueue = [];
    this.messageCallbacks.clear();
    this.readyCallbacks.clear();
  }

  private enqueue(message: string): void {
    const maxQueue = this.params.maxQueue ?? 100;
    if (this.sendQueue.length >= maxQueue) {
      this.sendQueue.shift();
    }
    this.sendQueue.push(message);
  }

  private flushQueue(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    while (this.sendQueue.length > 0) {
      const msg = this.sendQueue.shift();
      if (msg) {
        this.socket.send(msg);
      }
    }
  }

  private tryParse(data: WebSocket.RawData): unknown {
    try {
      const text = data?.toString();
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  getConfig(): { type: "ws"; url: string } | null {
    return this.config;
  }
}
