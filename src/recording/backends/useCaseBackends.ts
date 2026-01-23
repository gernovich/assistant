import type { App } from "obsidian";

import type { AssistantSettings } from "../../types";
import type { RecordingBackend, RecordingBackendId, RecordingBackendSessionHandle } from "../../application/recording/recordingUseCase";

import type { ElectronSession, LinuxNativeSession } from "../recordingSessionTypes";
import { ElectronMediaRecorderBackend } from "./electronMediaRecorderBackend";
import { LinuxFfmpegBackend } from "./linuxFfmpegBackend";

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

type LinuxHandle = RecordingBackendSessionHandle & {
  kind: "linux_native";
  impl: LinuxFfmpegBackend;
  session: LinuxNativeSession;
};

function asElectronHandle(h: RecordingBackendSessionHandle, log: Logger): ElectronHandle | null {
  if (h.kind !== "electron_media_devices") {
    log.error("Recording backend handle mismatch", { expected: "electron_media_devices", got: h.kind });
    return null;
  }
  return h as ElectronHandle;
}

function asLinuxHandle(h: RecordingBackendSessionHandle, log: Logger): LinuxHandle | null {
  if (h.kind !== "linux_native") {
    log.error("Recording backend handle mismatch", { expected: "linux_native", got: h.kind });
    return null;
  }
  return h as LinuxHandle;
}

export function createUseCaseRecordingBackends(params: {
  app: App;
  getSettings: () => AssistantSettings;
  getOnViz: () => ((amp01: number) => void) | undefined;
  log: Logger;
}): Record<RecordingBackendId, RecordingBackend> {
  let activeElectronSession: ElectronSession | null = null;
  let activeLinuxSession: LinuxNativeSession | null = null;

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
          params.getOnViz()?.(0);
        } else {
          if (!s.vizTimer && s.vizSample) s.vizTimer = window.setInterval(s.vizSample, 50);
        }
      } catch {
        // ignore
      }
    },
  };

  const linuxBackend: RecordingBackend = {
    async startSession(p: Parameters<RecordingBackend["startSession"]>[0]): Promise<RecordingBackendSessionHandle> {
      const now = Date.now();
      const s: LinuxNativeSession = {
        backend: "linux_native",
        status: "recording",
        startedAtMs: now,
        currentFileStartedAtMs: now,
        filesTotal: 0,
        filesRecognized: 0,
        foundProjects: 0,
        foundFacts: 0,
        foundPeople: 0,
        recordingsDir: p.recordingsDir,
        filePrefix: p.filePrefix,
        eventKey: p.eventKey,
        chunkEveryMs: 0,
        lastChunkAtMs: now,
        pendingWrites: new Set(),
        native: { proc: null, tmpPath: null, ext: "ogg", stderrTail: "" },
      };

      const impl = new LinuxFfmpegBackend({
        getSettings: params.getSettings,
        isActiveSession: (x) => activeLinuxSession === x,
        getOnViz: params.getOnViz,
        log: params.log,
        writeBinary,
        onFileSaved: (path) => p.onFileSaved(path),
      });

      await impl.startChunk(s);
      activeLinuxSession = s;
      const handle: LinuxHandle = { kind: "linux_native", impl, session: s };
      return handle;
    },
    async startNewChunk(handle: RecordingBackendSessionHandle) {
      const h = asLinuxHandle(handle, params.log);
      if (!h) return;
      await h.impl.startChunk(h.session);
    },
    async finalizeCurrentFile(handle: RecordingBackendSessionHandle) {
      const h = asLinuxHandle(handle, params.log);
      if (!h) return;
      await h.impl.finalizeFile(h.session);
    },
    async stopSession(handle: RecordingBackendSessionHandle) {
      const h = asLinuxHandle(handle, params.log);
      if (!h) return;
      const s = h.session;
      if (activeLinuxSession === s) activeLinuxSession = null;
      await h.impl.stopProc(s);
    },
    setPaused(handle: RecordingBackendSessionHandle, paused: boolean) {
      const h = asLinuxHandle(handle, params.log);
      if (!h) return;
      const s = h.session;
      s.status = paused ? "paused" : "recording";
      try {
        if (paused) params.getOnViz()?.(0);
      } catch {
        // ignore
      }
    },
  };

  return {
    electron_media_devices: electronBackend,
    linux_native: linuxBackend,
  };
}

