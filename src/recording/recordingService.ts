import { Notice, type App } from "obsidian";
import { normalizePath } from "obsidian";
import { ensureFolder } from "../vault/ensureFolder";
import type { AssistantSettings, Event } from "../types";
import { commandExists } from "../os/commandExists";
import { FM } from "../vault/frontmatterKeys";
import { parseFrontmatterMap, splitFrontmatter, upsertFrontmatter } from "../vault/frontmatter";
import { isTFile } from "../vault/ensureFile";
import fixWebmDuration from "fix-webm-duration";
import type { LogService } from "../log/logService";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { execFile as execFileNode } from "node:child_process";
import { linuxNativeFilterGraphPolicy } from "../domain/policies/ffmpegFilterGraph";
import { pickMediaRecorderMimeType } from "../domain/policies/mediaRecorderMimeType";
import { nextChunkInMsPolicy, shouldRotateChunkPolicy } from "../domain/policies/recordingChunkTiming";
import { amp01FromLufsPolicy, amp01FromRmsPolicy, amp01FromTimeDomainRmsPolicy, smoothAmp01Policy } from "../domain/policies/recordingVizAmp";
import { parseMomentaryLufsFromEbur128Line } from "../domain/policies/ebur128";
import { shouldEmitByInterval } from "../domain/policies/rateLimit";
import { rms01FromS16leMonoFrame } from "../domain/policies/pcmRms";
import { parseJsonStringArray } from "../domain/policies/frontmatterJsonArrays";
import { appendRollingText, splitLinesKeepRemainder } from "../domain/policies/rollingTextBuffer";
import { recordingChunkFileName, recordingFilePrefixFromEventKey } from "../domain/policies/recordingFileNaming";
import { DEFAULT_RECORDINGS_DIR } from "../domain/policies/recordingPaths";
import { recordingExtFromMimeType } from "../domain/policies/recordingExt";
import { pickDesktopCapturerSourceId } from "../domain/policies/desktopCapturerSource";
import {
  buildPulseMonitorCandidates,
  buildPulseMicCandidates,
  parsePactlDefaultSinkFromInfo,
  parsePactlDefaultSourceFromInfo,
  parsePactlGetDefaultSink,
} from "../domain/policies/pactl";
import { linuxNativeFfmpegArgsPolicy } from "../domain/policies/linuxNativeFfmpegArgs";
import { buildLinuxNativeSourceAttemptPlan } from "../domain/policies/linuxNativeSourcePlan";
import { trimForLogPolicy } from "../domain/policies/logText";

export type RecordingStatus = "idle" | "recording" | "paused";

export type RecordingStats = {
  status: RecordingStatus;
  startedAtMs?: number;
  elapsedMs?: number;
  filesTotal: number;
  filesRecognized: number;
  foundProjects?: number;
  foundFacts?: number;
  foundPeople?: number;
  /** Сколько мс до следующего чанка/файла (если запись активна). */
  nextChunkInMs?: number;
  eventKey?: string;
  /** Если запись привязана к протоколу — путь md-файла протокола в vault. */
  protocolFilePath?: string;
};

type BaseSession = {
  backend: "electron_desktop_capturer" | "linux_native";
  status: "recording" | "paused";
  startedAtMs: number;
  /** Время старта текущего файла/чанка (нужно для корректной длительности в WebM). */
  currentFileStartedAtMs: number;
  filesTotal: number;
  filesRecognized: number;
  foundProjects: number;
  foundFacts: number;
  foundPeople: number;
  recordingsDir: string;
  filePrefix: string;
  protocolFilePath?: string;
  protocolUpdateChain?: Promise<void>;
  eventKey?: string;
  chunkEveryMs: number;
  lastChunkAtMs: number;
  chunkTimer?: number;
  rotateChain?: Promise<void>;
  stopping?: boolean;
  pendingWrites: Set<Promise<void>>;
};

type ElectronSession = BaseSession & {
  backend: "electron_desktop_capturer";
  /** Поток, который пишет MediaRecorder (микрофон). */
  mediaStream: MediaStream;
  /** Входные потоки, которые нужно останавливать при stop() (только mic). */
  inputStreams: MediaStream[];
  recorder: MediaRecorder;
  mimeType: string;
  mimeTypePref: string;
  audioCtx?: AudioContext;
  analyser?: AnalyserNode;
  time?: Uint8Array;
  vizSample?: () => void;
  vizTimer?: number;
};

type LinuxNativeSession = BaseSession & {
  backend: "linux_native";
  native: {
    proc: import("child_process").ChildProcess | null;
    tmpPath: string | null;
    ext: "ogg";
    stderrTail: string;
    monitorName?: string;
    vizBuf?: string;
    lastAmp01?: number;
    lastVizAtMs?: number;
    lastVizParseErrAtMs?: number;
    lastVizDebugAtMs?: number;
    stopRequestedAtMs?: number;
    vizPcmBuf?: Buffer;
    vizPcmFrames?: number;
    vizPcmFramesAtMs?: number;
  };
};

type Session = ElectronSession | LinuxNativeSession;

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function execShell(cmd: string, timeoutMs = 2000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    execFileNode("sh", ["-lc", cmd], { timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

function pickMimeType(): string {
  return pickMediaRecorderMimeType({
    isSupported: (t) => typeof MediaRecorder !== "undefined" && Boolean((MediaRecorder as any).isTypeSupported?.(t)),
  });
}

export class RecordingService {
  private settings: AssistantSettings;
  private session: Session | null = null;
  private onStats?: (s: RecordingStats) => void;
  private onViz?: (amp01: number) => void;
  private log?: LogService;

  constructor(private app: App, settings: AssistantSettings, logService?: LogService) {
    this.settings = settings;
    this.log = logService;
  }

  setSettings(settings: AssistantSettings) {
    this.settings = settings;
  }

  private logInfo(message: string, data?: Record<string, unknown>) {
    try {
      this.log?.info(message, data);
    } catch {
      // ignore
    }
  }

  private logWarn(message: string, data?: Record<string, unknown>) {
    try {
      this.log?.warn(message, data);
    } catch {
      // ignore
    }
  }

  private logError(message: string, data?: Record<string, unknown>) {
    try {
      this.log?.error(message, data);
    } catch {
      // ignore
    }
  }

  private trimForLog(s: unknown, max = 1200): string {
    return trimForLogPolicy(s, max);
  }

  private linuxNativeFilterGraph(
    processing: "none" | "normalize" | "voice",
    wantVizPcm: boolean,
  ): { withMonitor: string; micOnly: string; withMonitorViz?: string; micOnlyViz?: string } {
    return linuxNativeFilterGraphPolicy(processing, wantVizPcm);
  }

  setOnStats(cb?: (s: RecordingStats) => void) {
    this.onStats = cb;
  }

  setOnViz(cb?: (amp01: number) => void) {
    this.onViz = cb;
  }

  getStats(): RecordingStats {
    if (!this.session) return { status: "idle", filesTotal: 0, filesRecognized: 0 };
    const now = Date.now();
    const nextChunkInMs = this.session.status === "recording"
      ? nextChunkInMsPolicy({ nowMs: now, lastChunkAtMs: this.session.lastChunkAtMs, chunkEveryMs: this.session.chunkEveryMs })
      : undefined;
    return {
      status: this.session.status === "paused" ? "paused" : "recording",
      startedAtMs: this.session.startedAtMs,
      elapsedMs: Math.max(0, now - this.session.startedAtMs),
      filesTotal: this.session.filesTotal,
      filesRecognized: this.session.filesRecognized,
      foundProjects: this.session.foundProjects,
      foundFacts: this.session.foundFacts,
      foundPeople: this.session.foundPeople,
      nextChunkInMs,
      eventKey: this.session.eventKey,
      protocolFilePath: this.session.protocolFilePath,
    };
  }

  /**
   * Хук на будущее: когда внешний пайплайн распознавания обработал очередной файл/чанк,
   * можно обновлять счётчики "Распознано" и "Найдено ...", и UI подтянет это через onStats/getStats.
   */
  updateProcessingStats(stats: { filesRecognized?: number; foundProjects?: number; foundFacts?: number; foundPeople?: number }): void {
    const s = this.session;
    if (!s) return;
    if (typeof stats.filesRecognized === "number" && Number.isFinite(stats.filesRecognized)) s.filesRecognized = Math.max(0, Math.floor(stats.filesRecognized));
    if (typeof stats.foundProjects === "number" && Number.isFinite(stats.foundProjects)) s.foundProjects = Math.max(0, Math.floor(stats.foundProjects));
    if (typeof stats.foundFacts === "number" && Number.isFinite(stats.foundFacts)) s.foundFacts = Math.max(0, Math.floor(stats.foundFacts));
    if (typeof stats.foundPeople === "number" && Number.isFinite(stats.foundPeople)) s.foundPeople = Math.max(0, Math.floor(stats.foundPeople));
    this.onStats?.(this.getStats());
  }

  private createRecorder(session: Session): MediaRecorder {
    if (session.backend !== "electron_desktop_capturer") throw new Error("createRecorder: unsupported backend");
    const mimeType = session.mimeTypePref || pickMimeType();
    const r = new MediaRecorder(session.mediaStream, mimeType ? { mimeType } : undefined);
    // mimeType может быть переопределён браузером
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
      // На Linux через xdg-desktop-portal захват экрана/аудио может "подвисать" на шаге Share.
      // Поэтому оборачиваем и discovery, и getUserMedia таймаутом — чтобы запись хотя бы с микрофона стартовала.
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

      // Для desktop capture в Chromium нужно указать chromeMediaSource в VIDEO constraints.
      // Чтобы получить именно аудио системы, ставим audio:true и тот же sourceId.
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

      // Видео нам не нужно — останавливаем сразу, чтобы не держать лишние ресурсы/разрешения.
      try {
        for (const t of stream.getVideoTracks()) t.stop();
      } catch (e) {
        this.logWarn("Electron capture: не удалось остановить video track", { error: String((e as unknown) ?? "") });
      }
      return stream;
    } catch {
      return null;
    }
  }

  private async getMicStreamForElectron(): Promise<{ stream: MediaStream; inputStreams: MediaStream[]; audioCtx?: AudioContext; analyser?: AnalyserNode; time?: Uint8Array }> {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    return { stream: mic, inputStreams: [mic] };
  }

  private async ensureFfmpegOrThrow(): Promise<void> {
    const ok = await commandExists("ffmpeg");
    if (ok) return;
    try {
      new Notice("Ассистент: Linux Native — не найден ffmpeg (установите ffmpeg)");
    } catch {
      // ignore
    }
    throw new Error("ffmpeg not found");
  }

  private async guessPulseMonitorSource(): Promise<string[]> {
    // Авто-детект monitor источника (то, что слышит пользователь) для PulseAudio/PipeWire-Pulse.
    const candidates: string[] = [];

    if (await commandExists("pactl")) {
      this.logInfo("Linux Native: pactl: читаю sources/sinks/sink-inputs для авто-выбора monitor");
      const srcList = await execShell("pactl list short sources 2>/dev/null");
      this.logInfo("Linux Native: pactl list short sources", {
        ok: srcList.ok,
        stdout: this.trimForLog(srcList.stdout, 1600),
        stderr: this.trimForLog(srcList.stderr, 400),
      });
      // Best practice: в первую очередь выбираем monitor того sink, куда реально выводят приложения сейчас.
      // Для этого берём sink-inputs и считаем, какой sink наиболее "активный".
      try {
        const sinks = await execShell("pactl list short sinks 2>/dev/null");
        this.logInfo("Linux Native: pactl list short sinks", {
          ok: sinks.ok,
          stdout: this.trimForLog(sinks.stdout, 1600),
          stderr: this.trimForLog(sinks.stderr, 400),
        });
        const sinkInputs = await execShell("pactl list short sink-inputs 2>/dev/null");
        this.logInfo("Linux Native: pactl list short sink-inputs", {
          ok: sinkInputs.ok,
          stdout: this.trimForLog(sinkInputs.stdout, 1600),
          stderr: this.trimForLog(sinkInputs.stderr, 400),
        });
        // Собираем кандидатов чистой policy, сохраняя прежний порядок/алиасы.
        const info = await execShell("pactl info 2>/dev/null");
        const r1 = await execShell("pactl get-default-sink 2>/dev/null | head -n1");
        const next = buildPulseMonitorCandidates({
          sourcesStdout: srcList.stdout,
          sinksStdout: sinks.stdout,
          sinkInputsStdout: sinkInputs.stdout,
          defaultSinkFromInfo: parsePactlDefaultSinkFromInfo(info.stdout),
          defaultSinkFromGetDefaultSink: parsePactlGetDefaultSink(r1.stdout),
        });
        for (const c of next) candidates.push(c);
      } catch (e) {
        this.logWarn("Linux Native: ошибка при анализе sinks/sink-inputs для авто-выбора monitor", { error: String((e as unknown) ?? "") });
      }
    }

    // buildPulseMonitorCandidates уже добавляет алиасы и дедуп.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of candidates) {
      const k = String(c || "").trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    // Если pactl отсутствует/не сработал — оставляем прежние алиасы.
    if (out.length === 0) return ["@DEFAULT_MONITOR@", "default.monitor"];
    return out;
  }

  private async guessPulseMicSource(): Promise<string[]> {
    // Авто-детект источника микрофона (default source) для PulseAudio/PipeWire-Pulse.
    const candidates: string[] = [];
    if (await commandExists("pactl")) {
      const info = await execShell("pactl info 2>/dev/null");
      this.logInfo("Linux Native: pactl info (для mic)", {
        ok: info.ok,
        stdout: this.trimForLog(info.stdout, 900),
        stderr: this.trimForLog(info.stderr, 300),
      });
      const srcInfo = parsePactlDefaultSourceFromInfo(info.stdout);
      const next = buildPulseMicCandidates({ defaultSourceFromInfo: srcInfo });
      for (const c of next) candidates.push(c);
    }

    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of candidates) {
      const k = String(c || "").trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    return out;
  }

  private async startLinuxNativeChunk(session: LinuxNativeSession): Promise<void> {
    await this.ensureFfmpegOrThrow();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { spawn } = require("child_process") as typeof import("child_process");
    const dir = await fs.mkdtemp(`${os.tmpdir()}/assistant-rec-`);
    const tmpPath = `${dir}/chunk.ogg`;

    session.native.stderrTail = "";
    session.native.tmpPath = tmpPath;
    session.currentFileStartedAtMs = Date.now();

    // Диагностика маршрутизации: хотим увидеть, какие playback streams (sink-inputs) есть и в какой sink они идут.
    // Это часто ключ к "YouTube не пишется": поток может быть не в default sink.
    if (await commandExists("pactl")) {
      const details = await execShell(
        "pactl list sink-inputs 2>/dev/null | grep -E '^\\s*(Sink:|Sink Input #|Client:|application\\.name =|media\\.name =|node\\.name =)' | head -n 220",
        2500,
      );
      this.logInfo("Linux Native: pactl sink-inputs (подробно, обрезано)", {
        ok: details.ok,
        stdout: this.trimForLog(details.stdout, 2500),
        stderr: this.trimForLog(details.stderr, 400),
      });
    }

    const micCandidates = await this.guessPulseMicSource();
    const monitorCandidates = await this.guessPulseMonitorSource();
    this.logInfo("Linux Native: кандидаты источников", {
      micCandidates,
      monitorCandidates: monitorCandidates.slice(0, 30),
    });

    const trySpawn = async (micName: string, monitorName: string | null): Promise<import("child_process").ChildProcess | null> => {
      // Для плавной визуализации читаем PCM со stdout. Если подписчика нет — не включаем второй output.
      const wantViz = Boolean(this.onViz);
      const processing = this.settings.recording?.linuxNativeAudioProcessing ?? "normalize";
      const g = this.linuxNativeFilterGraph(processing, wantViz);
      const args = linuxNativeFfmpegArgsPolicy({
        micName,
        monitorName,
        tmpPath,
        wantViz,
        processing,
        filterGraph: { withMonitor: g.withMonitor, withMonitorViz: g.withMonitorViz },
      });

      this.logInfo("Linux Native: ffmpeg spawn", {
        micName,
        monitorName,
        out: tmpPath,
        args: args.join(" "),
      });
      // Важно: чтобы останавливать ffmpeg “мягко” (и не получать SIGKILL + 0 байт),
      // держим stdin открытым и на stop() пишем 'q'.
      const proc = spawn("ffmpeg", args, { stdio: ["pipe", wantViz ? "pipe" : "ignore", "pipe"] });
      session.native.stderrTail = "";
      session.native.vizBuf = "";
      session.native.lastAmp01 = 0;
      session.native.lastVizAtMs = 0;
      session.native.lastVizParseErrAtMs = 0;
      session.native.stopRequestedAtMs = 0;
      session.native.vizPcmBuf = Buffer.alloc(0);
      session.native.vizPcmFrames = 0;
      session.native.vizPcmFramesAtMs = Date.now();

      proc.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
        // При корректной остановке через 'q'/SIGINT некоторые сборки ffmpeg возвращают code=255.
        // Это не ошибка, если stop был запрошен и файл успел дописаться.
        const stopAt = Number(session.native.stopRequestedAtMs ?? 0);
        const isLikelyStop = stopAt > 0 && Date.now() - stopAt < 15_000;
        const payload = { code, signal, stderrTail: this.trimForLog(session.native.stderrTail, 1600) };
        if (isLikelyStop) this.logInfo("Linux Native: ffmpeg exit (likely stop)", payload);
        else this.logWarn("Linux Native: ffmpeg exit", payload);
      });
      proc.stderr?.on("data", (buf: Buffer) => {
        const s = String(buf ?? "");
        session.native.stderrTail = appendRollingText({ prev: session.native.stderrTail, chunk: s, maxChars: 2000 });

        // Фолбек: если визуализация включена не через PCM (или PCM не активен), парсим ebur128 из stderr.
        try {
          session.native.vizBuf = appendRollingText({ prev: String(session.native.vizBuf ?? ""), chunk: s, maxChars: 8000 });
          // ffmpeg часто пишет прогресс через '\r' (без '\n'), поэтому делим по обоим.
          const { lines, remainder } = splitLinesKeepRemainder(session.native.vizBuf);
          session.native.vizBuf = remainder;
          for (const line of lines) {
            // Пример ebur128:
            // "... t: 3.28  M: -28.3 S: ... I: ... LUFS ..."
            const lufs = parseMomentaryLufsFromEbur128Line(line);
            if (lufs == null) continue;
            // Маппим LUFS в 0..1. Для визуализации берём более “чувствительный” диапазон:
            // примерно -70..-20 (обычная речь/системный звук). Иначе на тихом звуке индикатор почти нулевой.
            const amp01raw = amp01FromLufsPolicy(lufs);
            const prev = Number(session.native.lastAmp01 ?? 0);
            const amp01 = smoothAmp01Policy({ prev, raw: amp01raw, alpha: 0.25 });
            session.native.lastAmp01 = amp01;

            const now = Date.now();
            const lastAt = Number(session.native.lastVizAtMs ?? 0);
            if (!shouldEmitByInterval({ nowMs: now, lastAtMs: lastAt, intervalMs: 50 })) continue; // не чаще 20fps
            session.native.lastVizAtMs = now;

            if (this.session === session && session.status !== "paused") {
              this.onViz?.(amp01);
            }

            // Диагностика: раз в ~2 секунды пишем в лог, что метрика реально парсится во время записи.
            try {
              const now2 = Date.now();
              const lastDbg = Number(session.native.lastVizDebugAtMs ?? 0);
              if (now2 - lastDbg > 2000) {
                session.native.lastVizDebugAtMs = now2;
                this.logInfo("Linux Native: meter sample (ebur128)", {
                  lufsM: lufs,
                  amp01,
                });
              }
            } catch {
              // ignore
            }
          }
        } catch (e) {
          const now = Date.now();
          const last = Number(session.native.lastVizParseErrAtMs ?? 0);
          if (now - last > 5000) {
            session.native.lastVizParseErrAtMs = now;
            this.logWarn("Linux Native: ошибка парсинга метрик уровня из ffmpeg stderr", {
              error: String((e as unknown) ?? ""),
              stderrTail: this.trimForLog(session.native.stderrTail, 900),
            });
          }
        }
      });

      // Основной путь визуализации: читаем PCM (s16le mono 8kHz) из stdout и считаем RMS.
      if (wantViz && proc.stdout) {
        proc.stdout.on("data", (chunk: Buffer) => {
          try {
            const prevBuf = session.native.vizPcmBuf ?? Buffer.alloc(0);
            const buf = prevBuf.length ? Buffer.concat([prevBuf, chunk]) : chunk;
            const frameBytes = 200 * 2; // ~25ms @ 8kHz mono s16le
            let off = 0;
            while (off + frameBytes <= buf.length) {
              const frame = buf.subarray(off, off + frameBytes);
              off += frameBytes;
              const n = 200;
              const rms = rms01FromS16leMonoFrame(frame, n);
              // Маппинг RMS->dBFS->0..1 делает визуализацию заметной даже на тихих уровнях.
              // db ~= [-inf..0], берём диапазон -60..-12 dBFS.
              const { db, amp01raw } = amp01FromRmsPolicy(rms);
              const prev = Number(session.native.lastAmp01 ?? 0);
              const amp01 = smoothAmp01Policy({ prev, raw: amp01raw, alpha: 0.25 });
              session.native.lastAmp01 = amp01;

              const now = Date.now();
              const lastAt = Number(session.native.lastVizAtMs ?? 0);
              if (shouldEmitByInterval({ nowMs: now, lastAtMs: lastAt, intervalMs: 25 })) {
                session.native.lastVizAtMs = now;
                if (this.session === session && session.status !== "paused") this.onViz?.(amp01);
              }

              // Диагностика: считаем частоту прихода PCM кадров и раз в ~2с логируем.
              session.native.vizPcmFrames = Number(session.native.vizPcmFrames ?? 0) + 1;
              const framesAt = Number(session.native.vizPcmFramesAtMs ?? now);
              if (now - framesAt > 2000) {
                const frames = Number(session.native.vizPcmFrames ?? 0);
                const hz = frames / ((now - framesAt) / 1000);
                session.native.vizPcmFramesAtMs = now;
                session.native.vizPcmFrames = 0;
                this.logInfo("Linux Native: meter rate (pcm)", { hz: Number(hz.toFixed(1)), db: Number(db.toFixed(1)), amp01: Number(amp01.toFixed(3)) });
              }
            }
            session.native.vizPcmBuf = off ? buf.subarray(off) : buf;
          } catch (e) {
            const now = Date.now();
            const last = Number(session.native.lastVizParseErrAtMs ?? 0);
            if (now - last > 5000) {
              session.native.lastVizParseErrAtMs = now;
              this.logWarn("Linux Native: ошибка парсинга PCM для визуализации", { error: String((e as unknown) ?? "") });
            }
          }
        });
      }

      // Если ffmpeg сразу упал (например неверный monitor source) — считаем попытку неудачной.
      const exitedQuickly = await Promise.race([
        new Promise<boolean>((resolve) => proc.once("exit", () => resolve(true))),
        waitMs(300).then(() => false),
      ]);
      if (exitedQuickly) {
        this.logWarn("Linux Native: ffmpeg упал сразу (невалидный источник/маршрутизация?)", {
          micName,
          monitorName,
          stderrTail: this.trimForLog(session.native.stderrTail, 1200),
        });
        try {
          proc.kill("SIGKILL");
        } catch (e) {
          this.logWarn("Linux Native: не удалось прибить ffmpeg (SIGKILL) после быстрого exit", { error: String((e as unknown) ?? "") });
        }
        return null;
      }
      return proc;
    };

    let proc: import("child_process").ChildProcess | null = null;
    let pickedMonitor: string | undefined;
    let pickedMic: string | undefined;
    const attempts = buildLinuxNativeSourceAttemptPlan({ micCandidates, monitorCandidates });
    for (const a of attempts) {
      proc = await trySpawn(a.mic, a.monitor);
      if (!proc) continue;
      pickedMic = a.mic;
      pickedMonitor = a.monitor ?? undefined;
      break;
    }

    if (!proc) {
      // Если monitor не удалось подключить — не запускаем запись "втихую", это нарушит ожидания.
      try {
        new Notice("Ассистент: Linux Native — не удалось подключить системный звук (monitor). Проверьте PipeWire/Pulse monitor-источник.");
      } catch {
        // ignore
      }
      this.logError("Linux Native: не удалось стартовать ffmpeg с monitor", {
        micCandidates,
        monitorCandidates: monitorCandidates.slice(0, 20),
        stderrTail: this.trimForLog(session.native.stderrTail, 1600),
      });
      throw new Error(`linux_native: cannot start with monitor. stderrTail=${session.native.stderrTail}`);
    }

    session.native.proc = proc;
    session.native.monitorName = pickedMonitor;
    this.logInfo("Linux Native: запись стартовала", { pickedMic, pickedMonitor, tmpPath });
  }

  private async stopLinuxNativeProc(session: LinuxNativeSession): Promise<void> {
    const proc = session.native.proc;
    if (!proc) return;

    const waitExit = new Promise<void>((resolve) => {
      proc.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
        this.logInfo("Linux Native: ffmpeg close", { code, signal });
        resolve();
      });
      proc.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
        this.logInfo("Linux Native: ffmpeg exit (stop)", { code, signal });
        resolve();
      });
    });

    // 1) Самый надёжный способ корректно завершить запись: 'q' в stdin (ffmpeg сам допишет контейнер).
    try {
      session.native.stopRequestedAtMs = Date.now();
      if (proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.write("q");
        proc.stdin.end();
      }
    } catch (e) {
      this.logWarn("Linux Native: не удалось отправить 'q' в stdin ffmpeg", { error: String((e as unknown) ?? "") });
    }

    // 2) Fallback: SIGINT
    try {
      proc.kill("SIGINT");
    } catch (e) {
      this.logWarn("Linux Native: не удалось послать SIGINT ffmpeg", { error: String((e as unknown) ?? "") });
    }

    // ffmpeg иногда тратит время на flush/close (особенно с Pulse и opus), даём больше времени,
    // чтобы не получать SIGKILL + пустой файл.
    await Promise.race([waitExit, waitMs(8000)]);
    if ((proc as any).exitCode == null) {
      try {
        proc.kill("SIGKILL");
      } catch (e) {
        this.logWarn("Linux Native: не удалось послать SIGKILL ffmpeg", { error: String((e as unknown) ?? "") });
      }
      await Promise.race([waitExit, waitMs(2000)]);
    }

    session.native.proc = null;
  }

  private async finalizeLinuxNativeFile(session: LinuxNativeSession): Promise<void> {
    await this.stopLinuxNativeProc(session);
    const tmpPath = session.native.tmpPath;
    if (!tmpPath) return;
    session.native.tmpPath = null;

    const p = (async () => {
      try {
        // Перед чтением проверим, что ffmpeg реально создал файл (иначе сохранять нечего).
        try {
          const st = await fs.stat(tmpPath);
          this.logInfo("Linux Native: tmp file stat", { tmpPath, size: st.size });
        } catch (e) {
          this.logError("Linux Native: tmp file отсутствует (ffmpeg не создал выход?)", {
            tmpPath,
            error: String((e as unknown) ?? ""),
            stderrTail: this.trimForLog(session.native.stderrTail, 1600),
            monitorName: session.native.monitorName,
          });
          // Важно: не удаляем tmp-dir, чтобы можно было руками посмотреть /tmp/assistant-rec-*
          return;
        }

        const buf = await fs.readFile(tmpPath);
        if (!buf || buf.byteLength === 0) return;
        const name = recordingChunkFileName({ prefix: session.filePrefix, iso: new Date().toISOString(), ext: session.native.ext });
        const path = normalizePath(`${session.recordingsDir}/${name}`);
        await this.app.vault.createBinary(path, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        session.filesTotal += 1;
        await this.appendFileToProtocol(session, path);
        this.onStats?.(this.getStats());
      } catch (e) {
        const msg = String((e as unknown) ?? "");
        // Важно: не падаем; можно продолжить запись
        this.logError("Linux Native: ошибка финализации файла (read/save/append)", { error: msg, tmpPath });
      } finally {
        // Если файл не существует — tmpDir сохраняем для диагностики, cleanup пропускаем.
        // (см. ранний return выше)
        try {
          await fs.rm(tmpPath, { force: true });
          await fs.rm(tmpPath.replace(/\/chunk\.ogg$/, ""), { recursive: true, force: true });
        } catch (e) {
          this.logWarn("Linux Native: не удалось удалить временные файлы", { error: String((e as unknown) ?? ""), tmpPath });
        }
      }
    })();

    session.pendingWrites.add(p);
    void p.finally(() => session.pendingWrites.delete(p));
  }

  private attachRecorderHandlers(session: Session, recorder: MediaRecorder): void {
    if (session.backend !== "electron_desktop_capturer") return;
    const vault = this.app.vault;
    const recordingsDir = session.recordingsDir;
    const filePrefix = session.filePrefix;

    recorder.addEventListener("dataavailable", async (e: BlobEvent) => {
      const blob = e.data;
      if (!blob || blob.size === 0) return;
      const p = (async () => {
        try {
          const ext = recordingExtFromMimeType(session.mimeType || "");
          const durationMs = Math.max(0, Date.now() - session.currentFileStartedAtMs);

          // MediaRecorder WebM часто не содержит duration/cues → Obsidian (и Chromium) плохо видят длительность/seek.
          // Для webm делаем пост-обработку blob, чтобы файл стал "seekable".
          let fixedBlob: Blob = blob;
          if (ext === "webm") {
            // `fix-webm-duration` типизирован неидеально и может возвращать void в типах,
            // поэтому аккуратно фолбечим на исходный blob.
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
          await vault.createBinary(path, buf);
          session.filesTotal += 1;
          await this.appendFileToProtocol(session, path);
          this.onStats?.(this.getStats());
        } catch {
          // не падаем; продолжим запись
        }
      })();
      session.pendingWrites.add(p);
      void p.finally(() => session.pendingWrites.delete(p));
    });
  }

  private async appendFileToProtocol(session: Session, recordingFilePath: string): Promise<void> {
    const protocolPath = session.protocolFilePath;
    if (!protocolPath) return;

    const run = async () => {
      const af = this.app.vault.getAbstractFileByPath(protocolPath);
      if (!af || !isTFile(af)) return;

      const md = await this.app.vault.read(af);
      const { frontmatter } = splitFrontmatter(md);
      const map = frontmatter ? parseFrontmatterMap(frontmatter) : {};

      const raw = String(map[FM.files] ?? "[]").trim();
      const files = parseJsonStringArray(raw);

      if (!files.includes(recordingFilePath)) files.push(recordingFilePath);
      const next = upsertFrontmatter(md, { [FM.files]: JSON.stringify(files) });
      if (next !== md) await this.app.vault.modify(af, next);
    };

    // Сериализуем обновления (защита от гонок при нескольких чанках подряд).
    session.protocolUpdateChain = (session.protocolUpdateChain ?? Promise.resolve()).then(run, run);
    try {
      await session.protocolUpdateChain;
    } catch {
      // ignore
    }
  }

  private async finalizeCurrentFile(session: Session): Promise<void> {
    if (session.backend === "linux_native") {
      await this.finalizeLinuxNativeFile(session);
      try {
        await Promise.allSettled(Array.from(session.pendingWrites));
      } catch {
        // ignore
      }
      return;
    }

    const r = session.recorder;

    // Останавливаем recorder (если он ещё активен), чтобы "закрыть" текущий файл.
    // Важно: НЕ используем requestData() для нарезки — это давало битые сегменты в некоторых плеерах.
    const state = (r as any).state as string | undefined;
    if (state && state !== "inactive") {
      try {
        // Важно: гарантируем, что финальный dataavailable успел произойти после stop().
        const stopP = new Promise<void>((resolve) => {
          r.addEventListener("stop", () => resolve(), { once: true } as any);
        });
        const dataP = new Promise<void>((resolve) => {
          r.addEventListener("dataavailable", () => resolve(), { once: true } as any);
        });
        r.stop();

        // dataavailable может не прийти (например, если реально нет данных) — не блокируемся бесконечно.
        await Promise.race([Promise.all([stopP, dataP]).then(() => undefined), stopP, waitMs(1500)]);
      } catch {
        // ignore
      }
    }

    // Дожидаемся записи всех чанков (vault.createBinary + attach to protocol)
    try {
      await Promise.allSettled(Array.from(session.pendingWrites));
    } catch {
      // ignore
    }
  }

  private rotateChunk(session: Session, atMs: number): void {
    session.rotateChain = (session.rotateChain ?? Promise.resolve()).then(async () => {
      if (!this.session || this.session !== session) return;
      if (session.stopping) return;
      if (session.status !== "recording") return;

      session.lastChunkAtMs = atMs;
      // Закрываем текущий файл полностью и стартуем новый -> новый файл.
      await this.finalizeCurrentFile(session);
      if (!this.session || this.session !== session) return;
      if (session.stopping) return;
      if (session.status !== "recording") return;

      if (session.backend === "linux_native") {
        try {
          await this.startLinuxNativeChunk(session);
        } catch {
          // ignore
        }
      } else {
        const r = this.createRecorder(session);
        session.recorder = r;
        this.attachRecorderHandlers(session, r);
        try {
          session.currentFileStartedAtMs = Date.now();
          r.start();
        } catch {
          // ignore
        }
      }
      this.onStats?.(this.getStats());
    });
  }

  async start(params: { ev?: Event; eventKey?: string; protocolFilePath?: string }): Promise<void> {
    if (this.session) return;

    const backend = this.settings.recording.audioBackend || "electron_desktop_capturer";
    const chunkMinutes = Math.max(1, Math.floor(Number(this.settings.recording.chunkMinutes) || 5));
    const timesliceMs = chunkMinutes * 60_000;
    const mimeType = pickMimeType();

    const startedAtMs = Date.now();

    const recordingsDir = normalizePath(DEFAULT_RECORDINGS_DIR);
    const filePrefix = recordingFilePrefixFromEventKey(params.eventKey);

    // Маркер: пишем всегда, чтобы понимать, что start() реально вызвался и какой backend выбран.
    this.logInfo("Recording: start()", {
      backend,
      chunkMinutes,
      processing: this.settings.recording?.linuxNativeAudioProcessing ?? "normalize",
      eventKey: params.eventKey,
      protocolFilePath: params.protocolFilePath,
    });

    if (backend === "linux_native") {
      const s: LinuxNativeSession = {
        backend: "linux_native",
        status: "recording",
        startedAtMs,
        currentFileStartedAtMs: startedAtMs,
        filesTotal: 0,
        filesRecognized: 0,
        foundProjects: 0,
        foundFacts: 0,
        foundPeople: 0,
        recordingsDir,
        filePrefix,
        protocolFilePath: params.protocolFilePath,
        eventKey: params.eventKey,
        chunkEveryMs: timesliceMs,
        lastChunkAtMs: startedAtMs,
        pendingWrites: new Set(),
        native: { proc: null, tmpPath: null, ext: "ogg", stderrTail: "" },
      };
      this.session = s;
      await ensureFolder(this.app.vault, recordingsDir);
      await this.startLinuxNativeChunk(s);
      s.chunkTimer = window.setInterval(() => {
        if (!this.session || this.session !== s) return;
        if (s.stopping) return;
        if (s.status !== "recording") return;
        const now = Date.now();
        if (!shouldRotateChunkPolicy({ nowMs: now, lastChunkAtMs: s.lastChunkAtMs, chunkEveryMs: s.chunkEveryMs })) return;
        this.rotateChunk(s, now);
      }, 1000);
      this.onStats?.(this.getStats());
      return;
    }

    const { stream: mediaStream, inputStreams, audioCtx, analyser, time } = await this.getMicStreamForElectron();
    const recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
    const session: ElectronSession = {
      backend: "electron_desktop_capturer",
      status: "recording",
      startedAtMs,
      currentFileStartedAtMs: startedAtMs,
      mediaStream,
      inputStreams,
      recorder,
      mimeType: recorder.mimeType || mimeType,
      mimeTypePref: mimeType,
      filesTotal: 0,
      filesRecognized: 0,
      foundProjects: 0,
      foundFacts: 0,
      foundPeople: 0,
      recordingsDir,
      filePrefix,
      protocolFilePath: params.protocolFilePath,
      eventKey: params.eventKey,
      chunkEveryMs: timesliceMs,
      lastChunkAtMs: startedAtMs,
      pendingWrites: new Set(),
    };
    this.session = session;

    // Живая визуализация (волна/гистограмма) для UI
    try {
      if (audioCtx && analyser && time) {
        session.audioCtx = audioCtx;
        session.analyser = analyser;
        session.time = time;
      } else {
        const AudioContextCtor2 = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AudioContextCtor2) {
          const audioCtx2: AudioContext = new AudioContextCtor2();
          const source2 = audioCtx2.createMediaStreamSource(mediaStream);
          const analyser2 = audioCtx2.createAnalyser();
          analyser2.fftSize = 2048;
          analyser2.smoothingTimeConstant = 0.8;
          source2.connect(analyser2);
          const time2 = new Uint8Array(analyser2.fftSize);
          session.audioCtx = audioCtx2;
          session.analyser = analyser2;
          session.time = time2;
        }
      }

        const sample = () => {
          if (!this.session || this.session !== session) return;
          if (!this.onViz || !session.analyser || !session.time) return;
          // Важно: MediaRecorder.pause() НЕ выключает микрофонный MediaStream.
          // Если мы продолжаем читать analyser — UI будет показывать "звук" даже в паузе.
          if (session.status === "paused") {
            return;
          }
          try {
            // Типы DOM/TS вокруг Uint8Array здесь иногда конфликтуют (ArrayBuffer vs ArrayBufferLike),
            // но в рантайме analyser принимает обычный Uint8Array.
            (session.analyser as any).getByteTimeDomainData(session.time);

            // RMS амплитуда (0..1) — это и есть "громкость в момент времени"
            let sumSq = 0;
            let n = 0;
            for (let i = 0; i < session.time.length; i += 4) {
              const v = (session.time[i] - 128) / 128; // -1..1
              sumSq += v * v;
              n++;
            }
            const rms = n ? Math.sqrt(sumSq / n) : 0;
            const amp01 = amp01FromTimeDomainRmsPolicy(rms, 2.2);
            this.onViz(amp01);
          } catch {
            // ignore
          }
        };

        session.vizSample = sample;
        session.vizTimer = window.setInterval(sample, 50);
    } catch {
      // ignore
    }

    const vault = this.app.vault;
    await ensureFolder(vault, recordingsDir);
    this.attachRecorderHandlers(session, recorder);

    // Нарезка на отдельные файлы:
    // вместо requestData() (часто даёт битые сегменты) — останавливаем MediaRecorder и стартуем новый.
    session.currentFileStartedAtMs = Date.now();
    recorder.start();
    session.chunkTimer = window.setInterval(() => {
      if (!this.session || this.session !== session) return;
      if (session.stopping) return;
      if (session.status !== "recording") return;
      const now = Date.now();
      if (!shouldRotateChunkPolicy({ nowMs: now, lastChunkAtMs: session.lastChunkAtMs, chunkEveryMs: session.chunkEveryMs })) return;
      this.rotateChunk(session, now);
    }, 1000);
    this.onStats?.(this.getStats());
  }

  async pause(): Promise<void> {
    const s = this.session;
    if (!s) return;
    if (s.status === "paused") return;
    try {
      // Пауза по смыслу: завершить текущий файл и остановить запись.
      s.status = "paused";
      // Останавливаем таймер чанков — запись остановлена.
      try {
        if (s.chunkTimer) window.clearInterval(s.chunkTimer);
      } catch {
        // ignore
      }
      s.chunkTimer = undefined;
      // Останавливаем семплирование визуализации и принудительно шлём "тишину".
      try {
        if (s.backend === "electron_desktop_capturer" && s.vizTimer) window.clearInterval(s.vizTimer);
      } catch {
        // ignore
      }
      if (s.backend === "electron_desktop_capturer") s.vizTimer = undefined;
      try {
        this.onViz?.(0);
      } catch {
        // ignore
      }
      // Закрываем текущий файл: requestData + stop recorder + дождаться записи.
      s.lastChunkAtMs = Date.now();
      await this.finalizeCurrentFile(s);
      this.onStats?.(this.getStats());
    } catch {
      this.logWarn("Recording: pause() завершилась с ошибкой", { backend: this.session?.backend });
    }
  }

  resume(): void {
    const s = this.session;
    if (!s) return;
    if (s.status !== "paused") return;
    try {
      s.status = "recording";
      // Резюм по смыслу: стартовать новую запись (новый файл).
      if (s.backend === "linux_native") {
        void this.startLinuxNativeChunk(s);
        s.lastChunkAtMs = Date.now();
      } else {
        const r = this.createRecorder(s);
        s.recorder = r;
        this.attachRecorderHandlers(s, r);
        s.lastChunkAtMs = Date.now();
        s.currentFileStartedAtMs = s.lastChunkAtMs;
        r.start();
        // Возвращаем семплирование визуализации.
        if (!s.vizTimer && s.vizSample) {
          s.vizTimer = window.setInterval(s.vizSample, 50);
        }
      }
      // Запускаем таймер чанков заново.
      s.chunkTimer = window.setInterval(() => {
        if (!this.session || this.session !== s) return;
        if (s.stopping) return;
        if (s.status !== "recording") return;
        const now = Date.now();
        if (!shouldRotateChunkPolicy({ nowMs: now, lastChunkAtMs: s.lastChunkAtMs, chunkEveryMs: s.chunkEveryMs })) return;
        this.rotateChunk(s, now);
      }, 1000);
      this.onStats?.(this.getStats());
    } catch (e) {
      this.logWarn("Recording: resume() завершилась с ошибкой", { error: String((e as unknown) ?? ""), backend: this.session?.backend });
    }
  }

  async stop(): Promise<void> {
    const s = this.session;
    if (!s) return;
    s.stopping = true;
    try {
      // Останавливаем таймеры
      if (s.backend === "electron_desktop_capturer" && s.vizTimer) window.clearInterval(s.vizTimer);
    } catch (e) {
      this.logWarn("Recording: stop() не смог остановить таймеры", { error: String((e as unknown) ?? ""), backend: s.backend });
    }
    if (s.backend === "electron_desktop_capturer") s.vizTimer = undefined;
    try {
      if (s.chunkTimer) window.clearInterval(s.chunkTimer);
    } catch (e) {
      this.logWarn("Recording: stop() не смог остановить chunkTimer", { error: String((e as unknown) ?? ""), backend: s.backend });
    }
    s.chunkTimer = undefined;

    // Завершаем текущий файл (если запись активна/есть recorder)
    s.lastChunkAtMs = Date.now();
    await this.finalizeCurrentFile(s);

    if (s.backend === "electron_desktop_capturer") {
      try {
        void s.audioCtx?.close?.();
      } catch {
        // ignore
      }
      try {
        for (const st of s.inputStreams) {
          for (const t of st.getTracks()) t.stop();
        }
        for (const t of s.mediaStream.getTracks()) t.stop();
      } catch {
        // ignore
      }
    } else {
      try {
        await this.stopLinuxNativeProc(s);
      } catch (e) {
        this.logWarn("Linux Native: stop() не смог остановить ffmpeg", { error: String((e as unknown) ?? "") });
      }
    }
    this.session = null;
    try {
      this.onViz?.(0);
    } catch {
      // ignore
    }
    this.onStats?.({ status: "idle", filesTotal: 0, filesRecognized: 0 });
  }
}

