// Electron preload for assistant windows (reminder/recording).
//
// Goal: provide "real" IPC transport without document.title/executeJavaScript.
// We use MessageChannel for renderer<->renderer communication (Electron 27.0.0+).
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
let transportMode = null; // "messageChannel"
const transportReadyCallbacks = new Set();
const transportMessageCallbacks = new Set();

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

ipcRenderer.on("assistant/transport/config", (_event, config) => {
  try {
    if (config && config.type === "messageChannel") {
      transportMode = "messageChannel";
      if (messagePort) {
        transportNotifyReady();
      } else {
        transportReady = false;
      }
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
  const handleMessage = (evt) => {
    const data = evt?.data ?? evt;
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
  };
  if (typeof messagePort.start === "function") {
    messagePort.start();
  }
  if (typeof messagePort.on === "function") {
    messagePort.on("message", handleMessage);
  } else if (typeof messagePort.addEventListener === "function") {
    messagePort.addEventListener("message", handleMessage);
    if (typeof messagePort.start === "function") {
      messagePort.start();
    }
  } else if ("onmessage" in messagePort) {
    messagePort.onmessage = handleMessage;
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
      if (target && target.type === "messageChannel") {
        transportMode = "messageChannel";
        if (messagePort) {
          transportNotifyReady();
        }
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
      transportReady = false;
      transportMessageCallbacks.clear();
      transportReadyCallbacks.clear();
      if (messagePort && typeof messagePort.close === "function") {
        try {
          messagePort.close();
        } catch {
          // ignore
        }
      }
      messagePort = null;
    } catch {
      // ignore
    }
  },
});
