import type { App } from "obsidian";

import type { AssistantSettings } from "../../types";
import type { RecordingBackend, RecordingBackendId, RecordingBackendSessionHandle } from "../../application/recording/recordingUseCase";

import type { ElectronSession } from "../recordingSessionTypes";
import { ElectronMediaRecorderBackend } from "./electronMediaRecorderBackend";
import { normalizePath } from "obsidian";
import { recordingChunkFileName } from "../../domain/policies/recordingFileNaming";
import { startGstKitRecordWorker } from "../gstreamer/gstKitNode";

type Logger = {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

type ElectronHandle = RecordingBackendSessionHandle & {
  kind: "electron_media_devices";
  impl: ElectronMediaRecorderBackend;
  session: ElectronSession;
};

function asElectronHandle(h: RecordingBackendSessionHandle, log: Logger): ElectronHandle | null {
  if (h.kind !== "electron_media_devices") {
    log.error("Запись: не совпадает тип хэндла бэкенда", { expected: "electron_media_devices", got: h.kind });
    return null;
  }
  return h as ElectronHandle;
}

type GStreamerSession = {
  backend: "g_streamer";
  recordingsDir: string;
  filePrefix: string;
  eventKey?: string;
  outVaultPath: string;
  proc: ReturnType<typeof startGstKitRecordWorker> | null;
  onFileSaved: (path: string) => void;
};

type GStreamerHandle = RecordingBackendSessionHandle & {
  kind: "g_streamer";
  session: GStreamerSession;
};

function asGStreamerHandle(h: RecordingBackendSessionHandle, log: Logger): GStreamerHandle | null {
  if (h.kind !== "g_streamer") {
    log.error("Запись: не совпадает тип хэндла бэкенда", { expected: "g_streamer", got: h.kind });
    return null;
  }
  return h as GStreamerHandle;
}

export function createUseCaseRecordingBackends(params: {
  app: App;
  getSettings: () => AssistantSettings;
  getOnViz: () => ((p: { mic01: number; monitor01: number }) => void) | undefined;
  pluginDirPath: string | null;
  log: Logger;
}): Record<RecordingBackendId, RecordingBackend> {
  let activeElectronSession: ElectronSession | null = null;
  let activeGStreamerSession: GStreamerSession | null = null;

  const writeBinary = async (path: string, data: ArrayBuffer) => {
    await params.app.vault.createBinary(path, data);
  };

  const electronBackend: RecordingBackend = {
    async startSession(p: Parameters<RecordingBackend["startSession"]>[0]): Promise<RecordingBackendSessionHandle> {
      const s: ElectronSession = {
        backend: "electron_media_devices",
        status: "recording",
        startedAtMs: Date.now(),
        currentFileStartedAtMs: Date.now(),
        filesTotal: 0,
        filesRecognized: 0,
        foundProjects: 0,
        foundFacts: 0,
        foundPeople: 0,
        recordingsDir: p.recordingsDir,
        filePrefix: p.filePrefix,
        eventKey: p.eventKey,
        chunkEveryMs: 0,
        lastChunkAtMs: Date.now(),
        pendingWrites: new Set(),
        mediaStream: null as unknown as MediaStream,
        inputStreams: [] as MediaStream[],
        recorder: null as unknown as MediaRecorder,
        mimeType: "",
        mimeTypePref: p.mimeTypePref ?? "",
      };

      const impl = new ElectronMediaRecorderBackend({
        isActiveSession: (x) => activeElectronSession === x,
        getOnViz: params.getOnViz,
        getSettings: params.getSettings,
        log: params.log,
        writeBinary,
        onFileSaved: (path) => p.onFileSaved(path),
      });

      await impl.startSession(s);
      activeElectronSession = s;
      const handle: ElectronHandle = { kind: "electron_media_devices", impl, session: s };
      return handle;
    },
    async startNewChunk(handle: RecordingBackendSessionHandle) {
      const h = asElectronHandle(handle, params.log);
      if (!h) return;
      await h.impl.startNewChunk(h.session);
    },
    async finalizeCurrentFile(handle: RecordingBackendSessionHandle) {
      const h = asElectronHandle(handle, params.log);
      if (!h) return;
      await h.impl.finalizeCurrentFile(h.session);
    },
    async stopSession(handle: RecordingBackendSessionHandle) {
      const h = asElectronHandle(handle, params.log);
      if (!h) return;
      const s = h.session;
      if (activeElectronSession === s) activeElectronSession = null;
      await h.impl.stopSession(s);
    },
    setPaused(handle: RecordingBackendSessionHandle, paused: boolean) {
      const h = asElectronHandle(handle, params.log);
      if (!h) return;
      const s = h.session;
      s.status = paused ? "paused" : "recording";
      try {
        if (paused) {
          if (s.vizTimer) window.clearInterval(s.vizTimer);
          s.vizTimer = undefined;
          params.getOnViz()?.({ mic01: 0, monitor01: 0 });
        } else {
          if (!s.vizTimer && s.vizSample) s.vizTimer = window.setInterval(s.vizSample, 50);
        }
      } catch {
        // Игнорируем ошибки управления визуализацией.
      }
    },
  };

  const gstreamerBackend: RecordingBackend = {
    async startSession(p: Parameters<RecordingBackend["startSession"]>[0]): Promise<RecordingBackendSessionHandle> {
      if (!params.pluginDirPath) {
        return await Promise.reject(
          "GStreamer backend: pluginDirPath недоступен (нельзя запустить worker процесс с gst-kit).",
        );
      }

      const s: GStreamerSession = {
        backend: "g_streamer",
        recordingsDir: p.recordingsDir,
        filePrefix: p.filePrefix,
        eventKey: p.eventKey,
        outVaultPath: "",
        proc: null,
        onFileSaved: (path) => p.onFileSaved(path),
      };

      const startChunk = () => {
        const settings = params.getSettings();
        const rec = settings.recording;
        const iso = new Date().toISOString();
        const name = recordingChunkFileName({ prefix: s.filePrefix, iso, ext: "ogg" });
        const outVaultPath = normalizePath(`${s.recordingsDir}/${name}`);
        const outFsPath = (params.app.vault.adapter as any).getFullPath
          ? (params.app.vault.adapter as any).getFullPath(outVaultPath)
          : outVaultPath;
        s.outVaultPath = outVaultPath;

        // уровни: прокидываем в viz hub (без сглаживания)
        const proc = startGstKitRecordWorker({
          pluginDirPath: params.pluginDirPath!,
          micSource: String(rec.gstreamerMicSource || "auto"),
          monitorSource: String(rec.gstreamerMonitorSource || "auto"),
          outFsPath: String(outFsPath),
          processingMic: rec.gstreamerMicProcessing,
          processingMonitor: rec.gstreamerMonitorProcessing,
          levelIntervalMs: 100,
          micMixLevel: rec.gstreamerMicMixLevel,
          monitorMixLevel: rec.gstreamerMonitorMixLevel,
          log: params.log,
          onMessage: (m) => {
            if (activeGStreamerSession !== s) return;
            if (m.type === "level") {
              const micRaw = m.micDb ?? -100;
              const monitorRaw = m.monitorDb ?? -100;
              params.getOnViz()?.({ mic01: micRaw, monitor01: monitorRaw });
            }
            if (m.type === "error") {
              params.log.error("GStreamer worker error", { message: m.message, details: m.details as any });
            }
          },
        });
        s.proc = proc;
      };

      startChunk();
      activeGStreamerSession = s;
      const handle: GStreamerHandle = { kind: "g_streamer", session: s };
      return handle;
    },
    async startNewChunk(handle: RecordingBackendSessionHandle) {
      const h = asGStreamerHandle(handle, params.log);
      if (!h) return;
      const s = h.session;
      if (activeGStreamerSession !== s) return;
      // новый процесс -> новый файл
      const settings = params.getSettings();
      const rec = settings.recording;
      const iso = new Date().toISOString();
      const name = recordingChunkFileName({ prefix: s.filePrefix, iso, ext: "ogg" });
      const outVaultPath = normalizePath(`${s.recordingsDir}/${name}`);
      const outFsPath = (params.app.vault.adapter as any).getFullPath
        ? (params.app.vault.adapter as any).getFullPath(outVaultPath)
        : outVaultPath;
      s.outVaultPath = outVaultPath;

      const proc = startGstKitRecordWorker({
        pluginDirPath: params.pluginDirPath!,
        micSource: String(rec.gstreamerMicSource || "auto"),
        monitorSource: String(rec.gstreamerMonitorSource || "auto"),
        outFsPath: String(outFsPath),
        processingMic: rec.gstreamerMicProcessing,
        processingMonitor: rec.gstreamerMonitorProcessing,
        levelIntervalMs: 100,
        micMixLevel: rec.gstreamerMicMixLevel,
        monitorMixLevel: rec.gstreamerMonitorMixLevel,
        log: params.log,
        onMessage: (m) => {
          if (activeGStreamerSession !== s) return;
          if (m.type === "level") {
            const micRaw = m.micDb ?? -100;
            const monitorRaw = m.monitorDb ?? -100;
            params.getOnViz()?.({ mic01: micRaw, monitor01: monitorRaw });
          }
          if (m.type === "error") {
            params.log.error("GStreamer worker error", { message: m.message, details: m.details as any });
          }
        },
      });
      s.proc = proc;
    },
    async finalizeCurrentFile(handle: RecordingBackendSessionHandle) {
      const h = asGStreamerHandle(handle, params.log);
      if (!h) return;
      const s = h.session;
      if (activeGStreamerSession !== s) return;
      const proc = s.proc;
      const outVaultPath = s.outVaultPath;
      if (!proc) return;
      s.proc = null;
      try {
        proc.stop();
      } catch {
        // ignore
      }
      // ждём завершение, чтобы файл был корректно закрыт (EOS)
      const exit = await proc.waitExit();
      if (exit.code !== 0) {
        params.log.warn("GStreamer worker завершился неуспешно", { code: exit.code, signal: exit.signal });
      }
      if (outVaultPath) {
        s.onFileSaved(outVaultPath);
      }
      // на всякий случай очищаем viz
      params.getOnViz()?.({ mic01: 0, monitor01: 0 });
    },
    async stopSession(handle: RecordingBackendSessionHandle) {
      const h = asGStreamerHandle(handle, params.log);
      if (!h) return;
      const s = h.session;
      if (activeGStreamerSession === s) activeGStreamerSession = null;
      // finalizeCurrentFile уже вызван из use-case перед stopSession, но на всякий случай:
      if (s.proc) {
        try {
          await gstreamerBackend.finalizeCurrentFile(handle);
        } catch {
          // ignore
        }
      }
    },
  };

  return {
    electron_media_devices: electronBackend,
    g_streamer: gstreamerBackend,
  };
}
