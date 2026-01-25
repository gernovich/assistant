// Electron preload for assistant windows (reminder/recording).
//
// Goal: provide "real" IPC transport without document.title/executeJavaScript.
// We use MessageChannel for renderer<->renderer communication (Electron 27.0.0+).
// Legacy: ipcRenderer.sendTo() is deprecated, but kept for backward compatibility.
//
// Security: page itself stays without nodeIntegration; we expose a minimal API via contextBridge.

const electron = require("electron");
const { contextBridge, ipcRenderer } = electron;

let messagePort = null;
const portReadyCallbacks = new Set();
const messageListeners = new Set();
const pendingMessages = [];

// Transport bridge (dialog side) — hides transport implementation from UI.
let transportReady = false;
let transportSocket = null;
let transportUrl = null;
let transportWsCtor = null;
let transportMode = null; // "ws" | "messageChannel" | "webContents"
let webContentsHostId = 0;
let webContentsChannelToHost = "assistant/window/request";
let webContentsChannelFromHost = "assistant/window/response";
let webContentsListener = null;
const transportReadyCallbacks = new Set();
const transportMessageCallbacks = new Set();
const transportQueue = [];

function transportNotifyReady() {
  transportReady = true;
  for (const cb of transportReadyCallbacks) {
    try {
      cb();
    } catch {
      // ignore
    }
  }
}

function transportNotifyMessage(payload) {
  for (const cb of transportMessageCallbacks) {
    try {
      cb(payload);
    } catch {
      // ignore
    }
  }
}

function transportConnect(url) {
  transportMode = "ws";
  if (!url || url === transportUrl) return;
  transportUrl = url;
  if (transportSocket && typeof transportSocket.close === "function") {
    try {
      transportSocket.close();
    } catch {
      // ignore
    }
  }
  transportReady = false;
  if (!transportWsCtor) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      transportWsCtor = require("ws");
    } catch {
      transportWsCtor = null;
    }
  }
  if (!transportWsCtor) {
    try {
      transportWsCtor = globalThis.WebSocket;
    } catch {
      transportWsCtor = null;
    }
  }
  if (!transportWsCtor) {
    console.warn("[Assistant] Transport: WebSocket ctor недоступен");
    return;
  }
  try {
    transportSocket = new transportWsCtor(url);
  } catch (e) {
    console.warn("[Assistant] Transport: не удалось создать WebSocket", e);
    return;
  }
  transportSocket.addEventListener("open", () => {
    transportNotifyReady();
    while (transportQueue.length > 0 && transportSocket && transportSocket.readyState === 1) {
      const msg = transportQueue.shift();
      if (msg) {
        transportSocket.send(msg);
      }
    }
  });
  transportSocket.addEventListener("message", (evt) => {
    try {
      const data = JSON.parse(String(evt?.data ?? ""));
      transportNotifyMessage(data);
    } catch {
      // ignore
    }
  });
  transportSocket.addEventListener("close", () => {
    transportReady = false;
  });
}

ipcRenderer.on("assistant/transport/config", (_event, config) => {
  try {
    if (config && config.type === "ws" && typeof config.url === "string") {
      transportConnect(config.url);
      return;
    }
    if (config && config.type === "messageChannel") {
      transportMode = "messageChannel";
      if (messagePort) {
        transportNotifyReady();
      } else {
        transportReady = false;
      }
      return;
    }
    if (config && config.type === "webContents") {
      transportMode = "webContents";
      webContentsHostId = Number(config.hostId ?? 0);
      if (!Number.isFinite(webContentsHostId) || webContentsHostId <= 0) {
        console.warn("[Assistant] Transport: webContents requires hostId");
        transportReady = false;
        return;
      }
      webContentsChannelToHost = String(config.channelToDialog || "assistant/window/request");
      webContentsChannelFromHost = String(config.channelFromDialog || "assistant/window/response");
      if (webContentsListener) {
        try {
          ipcRenderer.removeListener(webContentsChannelFromHost, webContentsListener);
        } catch {
          // ignore
        }
      }
      webContentsListener = (_evt, payload) => {
        transportNotifyMessage(payload);
      };
      ipcRenderer.on(webContentsChannelFromHost, webContentsListener);
      transportNotifyReady();
      return;
    }
  } catch {
    // ignore
  }
});

ipcRenderer.on("assistant/message-channel-port", (event) => {
  const port = event?.ports?.[0];
  if (!port) return;
  messagePort = port;
  if (typeof messagePort.start === "function") {
    messagePort.start();
  }
  if (typeof messagePort.on === "function") {
    messagePort.on("message", (evt) => {
      const data = evt?.data;
      pendingMessages.push(data);
      for (const cb of messageListeners) {
        try {
          cb(data);
        } catch {
          // ignore
        }
      }
      try {
        transportNotifyMessage(data);
      } catch {
        // ignore
      }
    });
  }
  for (const cb of portReadyCallbacks) {
    try {
      cb();
    } catch {
      // ignore
    }
  }
  if (transportMode === "messageChannel") {
    transportNotifyReady();
  }
});

contextBridge.exposeInMainWorld("__assistantElectron", {
  // Legacy: устаревший API (deprecated в Electron 27.0.0+)
  sendTo: (targetId, channel, payload) => {
    try {
      const id = Number(targetId);
      if (!Number.isFinite(id)) return;
      ipcRenderer.sendTo(id, String(channel), payload);
    } catch {
      // ignore
    }
  },
  on: (channel, cb) => {
    try {
      ipcRenderer.on(String(channel), (_evt, payload) => {
        try {
          cb(payload);
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }
  },
  sendToHost: (targetId, channel, payload) => {
    try {
      const id = Number(targetId);
      if (!Number.isFinite(id)) return false;
      const remote = electron?.remote;
      const wc = remote?.webContents?.fromId ? remote.webContents.fromId(id) : null;
      if (!wc || typeof wc.send !== "function") return false;
      wc.send(String(channel), payload);
      return true;
    } catch {
      return false;
    }
  },
  // Новый API: MessageChannel для тестового диалога
  onMessageChannel: (callback) => {
    try {
      if (messagePort) {
        callback();
        return;
      }
      portReadyCallbacks.add(callback);
    } catch {
      // ignore
    }
  },
  messageChannelOn: (callback) => {
    try {
      const handler = (data) => callback(data);
      messageListeners.add(handler);
      if (pendingMessages.length > 0) {
        for (const msg of pendingMessages) {
          handler(msg);
        }
      }
      return !!messagePort;
    } catch {
      return false;
    }
  },
  messageChannelSend: (payload) => {
    try {
      if (!messagePort || typeof messagePort.postMessage !== "function") return false;
      messagePort.postMessage(payload);
      return true;
    } catch {
      return false;
    }
  },
});

contextBridge.exposeInMainWorld("__assistantTransport", {
  attach: (params) => {
    try {
      const target = params?.target;
      if (target && target.type === "ws" && target.url) {
        transportConnect(String(target.url));
        return;
      }
      if (target && target.type === "messageChannel") {
        transportMode = "messageChannel";
        if (messagePort) {
          transportNotifyReady();
        }
        return;
      }
      if (target && target.type === "webContents") {
        transportMode = "webContents";
        webContentsHostId = Number(target.hostId ?? 0);
        if (!Number.isFinite(webContentsHostId) || webContentsHostId <= 0) {
          console.warn("[Assistant] Transport: webContents requires hostId");
          transportReady = false;
          return;
        }
        webContentsChannelToHost = String(target.channelToDialog || "assistant/window/request");
        webContentsChannelFromHost = String(target.channelFromDialog || "assistant/window/response");
        if (webContentsListener) {
          try {
            ipcRenderer.removeListener(webContentsChannelFromHost, webContentsListener);
          } catch {
            // ignore
          }
        }
        webContentsListener = (_evt, payload) => {
          transportNotifyMessage(payload);
        };
        ipcRenderer.on(webContentsChannelFromHost, webContentsListener);
        transportNotifyReady();
        return;
      }
    } catch {
      // ignore
    }
  },
  isReady: () => transportReady,
  onReady: (cb) => {
    try {
      transportReadyCallbacks.add(cb);
      if (transportReady) cb();
      return () => transportReadyCallbacks.delete(cb);
    } catch {
      return () => undefined;
    }
  },
  send: (payload) => {
    try {
      if (transportMode === "messageChannel") {
        if (messagePort && typeof messagePort.postMessage === "function") {
          messagePort.postMessage(payload);
        }
        return;
      }
      if (transportMode === "webContents") {
        if (!webContentsHostId) return;
        ipcRenderer.sendTo(webContentsHostId, webContentsChannelToHost, payload);
        return;
      }
      const msg = JSON.stringify(payload ?? null);
      if (!transportSocket || transportSocket.readyState !== 1) {
        transportQueue.push(msg);
        return;
      }
      transportSocket.send(msg);
    } catch {
      // ignore
    }
  },
  onMessage: (cb) => {
    try {
      transportMessageCallbacks.add(cb);
      return () => transportMessageCallbacks.delete(cb);
    } catch {
      return () => undefined;
    }
  },
  close: () => {
    try {
      if (transportSocket) {
        transportSocket.close();
      }
      transportSocket = null;
      transportReady = false;
      transportQueue.length = 0;
      transportMessageCallbacks.clear();
      transportReadyCallbacks.clear();
      if (webContentsListener) {
        try {
          ipcRenderer.removeListener(webContentsChannelFromHost, webContentsListener);
        } catch {
          // ignore
        }
        webContentsListener = null;
      }
    } catch {
      // ignore
    }
  },
});
