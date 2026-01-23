import { normalizePath } from "obsidian";
import fixWebmDuration from "fix-webm-duration";

import type { ElectronSession } from "../recordingSessionTypes";

import { recordingChunkFileName } from "../../domain/policies/recordingFileNaming";
import { recordingExtFromMimeType } from "../../domain/policies/recordingExt";
import { amp01FromTimeDomainRmsPolicy } from "../../domain/policies/recordingVizAmp";
import { pickMediaRecorderMimeType } from "../../domain/policies/mediaRecorderMimeType";
import { pickDesktopCapturerSourceId } from "../../domain/policies/desktopCapturerSource";

type Logger = {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

async function waitMs(ms: number): Promise<void> {
  return await new Promise((resolve) => window.setTimeout(resolve, ms));
}

function pickMimeType(): string {
  return pickMediaRecorderMimeType({
    isSupported: (t) => typeof MediaRecorder !== "undefined" && Boolean((MediaRecorder as any).isTypeSupported?.(t)),
  });
}

export class ElectronMediaRecorderBackend {
  constructor(
    private params: {
      isActiveSession: (s: ElectronSession) => boolean;
      getOnViz: () => ((amp01: number) => void) | undefined;
      log: Logger;
      writeBinary: (path: string, data: ArrayBuffer) => Promise<void>;
      onFileSaved?: (recordingFilePath: string) => void;
    },
  ) {}

  private createRecorder(session: ElectronSession): MediaRecorder {
    const mimeType = session.mimeTypePref || pickMimeType();
    const r = new MediaRecorder(session.mediaStream, mimeType ? { mimeType } : undefined);
    session.mimeType = r.mimeType || mimeType || session.mimeType;
    return r;
  }

  private async tryGetDesktopAudioStream(): Promise<MediaStream | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let electron: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      electron = require("electron");
    } catch {
      return null;
    }

    const desktopCapturer = electron?.remote?.desktopCapturer ?? electron?.desktopCapturer;
    if (!desktopCapturer?.getSources) return null;

    try {
      const sources = await Promise.race([
        desktopCapturer.getSources({
          types: ["window", "screen"],
          fetchWindowIcons: false,
          thumbnailSize: { width: 0, height: 0 },
        }),
        waitMs(8000).then(() => null),
      ]);
      if (!sources) return null;
      if (!Array.isArray(sources) || sources.length === 0) return null;

      const id = pickDesktopCapturerSourceId(sources as any);
      if (!id) return null;

      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: id,
            },
          } as any,
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: id,
              maxWidth: 1,
              maxHeight: 1,
              maxFrameRate: 1,
            },
          } as any,
        } as any),
        waitMs(12000).then(() => null),
      ]);
      if (!stream) return null;

      try {
        for (const t of stream.getVideoTracks()) t.stop();
      } catch {
        // ignore
      }
      return stream;
    } catch {
      return null;
    }
  }

  private async getMicStreamForElectron(): Promise<{ stream: MediaStream; inputStreams: MediaStream[] }> {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    return { stream: mic, inputStreams: [mic] };
  }

  private attachRecorderHandlers(session: ElectronSession, recorder: MediaRecorder): void {
    const recordingsDir = session.recordingsDir;
    const filePrefix = session.filePrefix;

    recorder.addEventListener("dataavailable", async (e: BlobEvent) => {
      const blob = (e as any).data as Blob | undefined;
      if (!blob || blob.size === 0) return;
      const p = (async () => {
        try {
          const ext = recordingExtFromMimeType(session.mimeType || "");
          const durationMs = Math.max(0, Date.now() - session.currentFileStartedAtMs);

          let fixedBlob: Blob = blob;
          if (ext === "webm") {
            const maybe = (await fixWebmDuration(blob, durationMs, { logger: false } as any)) as unknown;
            if (maybe && typeof (maybe as any).size === "number") fixedBlob = maybe as Blob;
          }

          const buf =
            typeof (fixedBlob as any).arrayBuffer === "function"
              ? await (fixedBlob as any).arrayBuffer()
              : await new Response(fixedBlob).arrayBuffer();
          const iso = new Date().toISOString();
          const name = recordingChunkFileName({ prefix: filePrefix, iso, ext });
          const path = normalizePath(`${recordingsDir}/${name}`);
          await this.params.writeBinary(path, buf);
          this.params.onFileSaved?.(path);
        } catch (err) {
          this.params.log.error("Recording: ошибка сохранения файла из MediaRecorder", { error: String((err as unknown) ?? "") });
        }
      })();

      session.pendingWrites.add(p);
      void p.finally(() => session.pendingWrites.delete(p));
    });
  }

  private setupViz(session: ElectronSession): void {
    try {
      const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) return;

      const audioCtx: AudioContext = new AudioContextCtor();
      const source = audioCtx.createMediaStreamSource(session.mediaStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      const time = new Uint8Array(analyser.fftSize);

      session.audioCtx = audioCtx;
      session.analyser = analyser;
      session.time = time;

      const sample = () => {
        if (!this.params.isActiveSession(session)) return;
        if (!this.params.getOnViz() || !session.analyser || !session.time) return;
        if (session.status === "paused") return;
        try {
          (session.analyser as any).getByteTimeDomainData(session.time);
          let sumSq = 0;
          let n = 0;
          for (let i = 0; i < session.time.length; i += 4) {
            const v = (session.time[i] - 128) / 128;
            sumSq += v * v;
            n++;
          }
          const rms = n ? Math.sqrt(sumSq / n) : 0;
          const amp01 = amp01FromTimeDomainRmsPolicy(rms, 2.2);
          this.params.getOnViz()?.(amp01);
        } catch {
          // ignore
        }
      };

      session.vizSample = sample;
      session.vizTimer = window.setInterval(sample, 50);
    } catch {
      // ignore
    }
  }

  async startSession(session: ElectronSession): Promise<void> {
    // В текущем поведении используем mic-only (как было в RecordingService).
    // Desktop/system audio захват оставлен как опциональный метод на будущее.
    const { stream: mediaStream, inputStreams } = await this.getMicStreamForElectron();
    session.mediaStream = mediaStream;
    session.inputStreams = inputStreams;

    const recorder = this.createRecorder(session);
    session.recorder = recorder;

    this.attachRecorderHandlers(session, recorder);
    this.setupViz(session);

    session.currentFileStartedAtMs = Date.now();
    recorder.start();
  }

  async startNewChunk(session: ElectronSession): Promise<void> {
    const r = this.createRecorder(session);
    session.recorder = r;
    this.attachRecorderHandlers(session, r);
    session.currentFileStartedAtMs = Date.now();
    r.start();
  }

  async finalizeCurrentFile(session: ElectronSession): Promise<void> {
    const r = session.recorder;
    const state = (r as any).state as string | undefined;
    if (state && state !== "inactive") {
      try {
        const stopP = new Promise<void>((resolve) => {
          r.addEventListener("stop", () => resolve(), { once: true } as any);
        });
        const dataP = new Promise<void>((resolve) => {
          r.addEventListener("dataavailable", () => resolve(), { once: true } as any);
        });
        r.stop();
        await Promise.race([Promise.all([stopP, dataP]).then(() => undefined), stopP, waitMs(1500)]);
      } catch {
        // ignore
      }
    }
    try {
      await Promise.allSettled(Array.from(session.pendingWrites));
    } catch {
      // ignore
    }
  }

  async stopSession(session: ElectronSession): Promise<void> {
    try {
      void session.audioCtx?.close?.();
    } catch {
      // ignore
    }
    try {
      for (const st of session.inputStreams) {
        for (const t of st.getTracks()) t.stop();
      }
      for (const t of session.mediaStream.getTracks()) t.stop();
    } catch {
      // ignore
    }
  }
}
