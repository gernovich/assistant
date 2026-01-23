// Electron preload for assistant windows (reminder/recording).
//
// Goal: provide "real" IPC transport without document.title/executeJavaScript.
// We use ipcRenderer.sendTo(webContentsId, ...) to communicate renderer<->renderer without ipcMain handlers.
//
// Security: page itself stays without nodeIntegration; we expose a minimal API via contextBridge.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("__assistantElectron", {
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
});
