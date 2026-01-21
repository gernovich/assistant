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

const DEFAULT_RECORDINGS_DIR = "Ассистент/Записи";

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
  const prefs = [
    "audio/ogg;codecs=opus",
    "audio/ogg",
    // webm/opus часто плохо дружит с длительностью/seek в некоторых плеерах Obsidian,
    // поэтому предпочитаем ogg, но оставляем webm как fallback.
    "audio/webm;codecs=opus",
    "audio/webm",
  ];
  for (const t of prefs) {
    try {
      if (typeof MediaRecorder !== "undefined" && (MediaRecorder as any).isTypeSupported?.(t)) return t;
    } catch {
      // ignore
    }
  }
  return "";
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
    const text = String(s ?? "");
    if (text.length <= max) return text;
    return text.slice(0, max) + "…(truncated)";
  }

  private linuxNativeFilterGraph(
    processing: "none" | "normalize" | "voice",
    wantVizPcm: boolean,
  ): { withMonitor: string; micOnly: string; withMonitorViz?: string; micOnlyViz?: string } {
    // Важно: запись Linux Native может включать mic+monitor. Шумодав после микса может портить системный звук,
    // поэтому "voice" обрабатывает только mic-вход до amix.
    const postNormalize = "loudnorm=I=-16:TP=-1.5:LRA=11:linear=true,alimiter=limit=0.97";
    const micVoice = "highpass=f=80,lowpass=f=12000,afftdn=nf=-25";
    // Важно для стабильности: приводим оба входа к одному формату/частоте/каналам ДО микса.
    // Иначе mic (mono) + monitor (stereo) могут миксоваться/маппиться непредсказуемо на разных системах.
    const prep = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,aresample=48000";
    // Метр для UI (осциллограмма/индикатор): печатаем RMS в /dev/stderr через ametadata=print,
    // чтобы не зависеть от ffmpeg loglevel.
    // Для плавной визуализации лучше читать реальные аудио-сэмплы.
    // `vizPcm`: берём финальный микс, режем в моно 8kHz и фиксируем блоки по ~25мс (200 сэмплов).
    // Это даёт более плавный график без сильной нагрузки.
    const vizPcm = "aresample=8000,aformat=sample_fmts=s16:channel_layouts=mono,asetnsamples=n=200:p=0";
    // Фолбек-метр (если не читаем PCM): `ebur128` печатает строки во время записи.
    const meter = "ebur128=peak=true:framelog=info,anullsink";

    if (processing === "none") {
      const base = {
        withMonitor:
          `[0:a]${prep}[mic];` +
          `[1:a]${prep}[mon];` +
          "[mic][mon]amix=inputs=2:weights=1 1:duration=longest:dropout_transition=2:normalize=0[mix];" +
          "[mix]asplit=2[out][m];" +
          `[m]${meter}`,
        micOnly: `[0:a]${prep}[out];[out]asplit=2[a][m];[m]${meter}`,
      };
      if (!wantVizPcm) return base;
      return {
        ...base,
        withMonitorViz:
          `[0:a]${prep}[mic];` +
          `[1:a]${prep}[mon];` +
          "[mic][mon]amix=inputs=2:weights=1 1:duration=longest:dropout_transition=2:normalize=0[mix];" +
          "[mix]asplit=2[out][v];" +
          `[v]${vizPcm}[viz]`,
        micOnlyViz: `[0:a]${prep}[a];[a]asplit=2[out][v];[v]${vizPcm}[viz]`,
      };
    }

    if (processing === "voice") {
      const base = {
        withMonitor:
          `[0:a]${prep},${micVoice}[mic];` +
          `[1:a]${prep}[mon];` +
          "[mic][mon]amix=inputs=2:weights=1 1:duration=longest:dropout_transition=2:normalize=0[mix];" +
          "[mix]asplit=2[a][m];" +
          `[a]${postNormalize}[out];` +
          `[m]${meter}`,
        micOnly: `[0:a]${prep},${micVoice},${postNormalize}[out];[out]asplit=2[a][m];[m]${meter}`,
      };
      if (!wantVizPcm) return base;
      return {
        ...base,
        withMonitorViz:
          `[0:a]${prep},${micVoice}[mic];` +
          `[1:a]${prep}[mon];` +
          "[mic][mon]amix=inputs=2:weights=1 1:duration=longest:dropout_transition=2:normalize=0[mix];" +
          `[mix]${postNormalize}[mixn];` +
          "[mixn]asplit=2[out][v];" +
          `[v]${vizPcm}[viz]`,
        micOnlyViz: `[0:a]${prep},${micVoice},${postNormalize}[a];[a]asplit=2[out][v];[v]${vizPcm}[viz]`,
      };
    }

    // normalize
    const base = {
      withMonitor:
        `[0:a]${prep}[mic];` +
        `[1:a]${prep}[mon];` +
        "[mic][mon]amix=inputs=2:weights=1 1:duration=longest:dropout_transition=2:normalize=0[mix];" +
        "[mix]asplit=2[a][m];" +
        `[a]${postNormalize}[out];` +
        `[m]${meter}`,
      micOnly: `[0:a]${prep},${postNormalize}[out];[out]asplit=2[a][m];[m]${meter}`,
    };
    if (!wantVizPcm) return base;
    return {
      ...base,
      withMonitorViz:
        `[0:a]${prep}[mic];` +
        `[1:a]${prep}[mon];` +
        "[mic][mon]amix=inputs=2:weights=1 1:duration=longest:dropout_transition=2:normalize=0[mix];" +
        `[mix]${postNormalize}[mixn];` +
        "[mixn]asplit=2[out][v];" +
        `[v]${vizPcm}[viz]`,
      micOnlyViz: `[0:a]${prep},${postNormalize}[a];[a]asplit=2[out][v];[v]${vizPcm}[viz]`,
    };
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
    const nextChunkInMs =
      this.session.status === "recording"
        ? Math.max(0, this.session.chunkEveryMs - Math.max(0, now - this.session.lastChunkAtMs))
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

      const pick =
        sources.find((s: any) => /chrome|chromium|brave|firefox|yandex/i.test(String(s?.name ?? ""))) ??
        sources.find((s: any) => /screen|entire/i.test(String(s?.name ?? ""))) ??
        sources[0];
      const id = String(pick?.id ?? "").trim();
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
      const srcRows = srcList.stdout
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);

      const monitorSources = new Set<string>();
      const runningMonitors: string[] = [];
      const idleMonitors: string[] = [];
      for (const row of srcRows) {
        const parts = row.split(/\s+/);
        const name = String(parts[1] ?? "").trim();
        const state = String(parts[parts.length - 1] ?? "").trim().toUpperCase();
        if (!name.endsWith(".monitor")) continue;
        monitorSources.add(name);
        if (state === "RUNNING") runningMonitors.push(name);
        else if (state === "IDLE") idleMonitors.push(name);
      }

      // Best practice: в первую очередь выбираем monitor того sink, куда реально выводят приложения сейчас.
      // Для этого берём sink-inputs и считаем, какой sink наиболее "активный".
      try {
        const sinks = await execShell("pactl list short sinks 2>/dev/null");
        this.logInfo("Linux Native: pactl list short sinks", {
          ok: sinks.ok,
          stdout: this.trimForLog(sinks.stdout, 1600),
          stderr: this.trimForLog(sinks.stderr, 400),
        });
        const sinkRows = sinks.stdout
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean);
        const sinkIdxToName = new Map<string, string>();
        const runningSinks: string[] = [];
        for (const row of sinkRows) {
          const parts = row.split(/\s+/);
          const idx = String(parts[0] ?? "").trim();
          const name = String(parts[1] ?? "").trim();
          const state = String(parts[parts.length - 1] ?? "").trim().toUpperCase();
          if (idx && name) sinkIdxToName.set(idx, name);
          if (name && state === "RUNNING") runningSinks.push(name);
        }

        const sinkInputs = await execShell("pactl list short sink-inputs 2>/dev/null");
        this.logInfo("Linux Native: pactl list short sink-inputs", {
          ok: sinkInputs.ok,
          stdout: this.trimForLog(sinkInputs.stdout, 1600),
          stderr: this.trimForLog(sinkInputs.stderr, 400),
        });
        const inRows = sinkInputs.stdout
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean);
        const counts = new Map<string, { running: number; total: number }>();
        for (const row of inRows) {
          const parts = row.split(/\s+/);
          const sinkIdx = String(parts[1] ?? "").trim();
          const state = String(parts[parts.length - 1] ?? "").trim().toUpperCase();
          if (!sinkIdx) continue;
          const cur = counts.get(sinkIdx) ?? { running: 0, total: 0 };
          cur.total += 1;
          if (state === "RUNNING") cur.running += 1;
          counts.set(sinkIdx, cur);
        }

        const activeSinkNames = Array.from(counts.entries())
          .map(([idx, c]) => ({ name: sinkIdxToName.get(idx) ?? "", running: c.running, total: c.total }))
          .filter((x) => Boolean(x.name))
          .sort((a, b) => (b.running - a.running) || (b.total - a.total))
          .map((x) => x.name);

        for (const sinkName of activeSinkNames) {
          const mon = `${sinkName}.monitor`;
          if (monitorSources.has(mon)) candidates.push(mon);
        }
        // Если sink-inputs пуст — пробуем RUNNING sinks.
        for (const sinkName of runningSinks) {
          const mon = `${sinkName}.monitor`;
          if (monitorSources.has(mon)) candidates.push(mon);
        }
        this.logInfo("Linux Native: auto-monitor кандидаты по sink-inputs", {
          activeSinkNames,
          candidates: candidates.slice(0, 10),
        });
      } catch (e) {
        this.logWarn("Linux Native: ошибка при анализе sinks/sink-inputs для авто-выбора monitor", { error: String((e as unknown) ?? "") });
      }

      // Затем — активные monitor-источники (RUNNING/IDLE).
      for (const n of runningMonitors) candidates.push(n);
      for (const n of idleMonitors) candidates.push(n);

      // Самый надёжный путь: pactl info -> Default Sink -> <sink>.monitor
      const info = await execShell("pactl info 2>/dev/null");
      this.logInfo("Linux Native: pactl info", { ok: info.ok, stdout: this.trimForLog(info.stdout, 1600), stderr: this.trimForLog(info.stderr, 400) });
      const mSink = info.stdout.match(/^Default Sink:\s*(.+)$/m);
      const sinkInfo = (mSink?.[1] ?? "").trim();
      if (sinkInfo) {
        const mon = `${sinkInfo}.monitor`;
        if (monitorSources.has(mon)) candidates.push(mon);
      }

      const r1 = await execShell("pactl get-default-sink 2>/dev/null | head -n1");
      const sink1 = r1.stdout.trim();
      if (sink1) {
        const mon = `${sink1}.monitor`;
        if (monitorSources.has(mon)) candidates.push(mon);
      }

      if (!sink1) {
        const r2 = await execShell("pactl info 2>/dev/null | sed -n 's/^Default Sink: //p' | head -n1");
        const sink2 = r2.stdout.trim();
        if (sink2) {
          const mon = `${sink2}.monitor`;
          if (monitorSources.has(mon)) candidates.push(mon);
        }
      }

      // Как фолбек — первые monitor-источники из списка.
      const more = srcRows
        .map((row) => String(row.split(/\s+/)[1] ?? "").trim())
        .filter((n) => n.endsWith(".monitor"))
        .slice(0, 8);
      for (const n of more) candidates.push(n);
    }

    // PipeWire-Pulse алиасы (не везде работают, но дешёвый фолбек)
    candidates.push("@DEFAULT_MONITOR@");
    candidates.push("default.monitor");

    // уникализируем, сохраняя порядок
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
      const mSrc = info.stdout.match(/^Default Source:\s*(.+)$/m);
      const srcInfo = (mSrc?.[1] ?? "").trim();
      if (srcInfo) candidates.push(srcInfo);
    }
    // PulseAudio alias
    candidates.push("@DEFAULT_SOURCE@");
    candidates.push("default");

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
      const args = ["-hide_banner", "-nostats", "-loglevel", wantViz ? "error" : "error"];
      // буфер на входах, чтобы Pulse не ронял/не дропал при кратких пиках нагрузки
      args.push("-thread_queue_size", "1024", "-f", "pulse", "-i", micName);
      if (monitorName) {
        args.push("-thread_queue_size", "1024", "-f", "pulse", "-i", monitorName);
        const processing = this.settings.recording?.linuxNativeAudioProcessing ?? "normalize";
        const g = this.linuxNativeFilterGraph(processing, wantViz);
        const graph = wantViz && g.withMonitorViz ? g.withMonitorViz : g.withMonitor;
        args.push("-filter_complex", graph, "-map", "[out]");
      }
      // Output #0: файл (opus/ogg)
      args.push("-ac", "2", "-ar", "48000", "-c:a", "libopus", "-b:a", "96k", "-application", "audio", "-y", tmpPath);
      // Output #1: PCM для визуализации (stdout), только если нужно.
      if (wantViz) {
        args.push("-map", "[viz]", "-f", "s16le", "-ac", "1", "-ar", "8000", "pipe:1");
      }

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
        session.native.stderrTail = (session.native.stderrTail + s).slice(-2000);

        // Фолбек: если визуализация включена не через PCM (или PCM не активен), парсим ebur128 из stderr.
        try {
          session.native.vizBuf = (String(session.native.vizBuf ?? "") + s).slice(-8000);
          // ffmpeg часто пишет прогресс через '\r' (без '\n'), поэтому делим по обоим.
          const parts = session.native.vizBuf.split(/[\r\n]+/);
          session.native.vizBuf = parts.pop() ?? "";
          for (const line of parts) {
            // Пример ebur128:
            // "... t: 3.28  M: -28.3 S: ... I: ... LUFS ..."
            const mLufs = line.match(/\bM:\s*([-\d.]+)\b/);
            if (!mLufs?.[1]) continue;
            const lufs = Number(mLufs[1]);
            if (!Number.isFinite(lufs)) continue;
            // Маппим LUFS в 0..1. Для визуализации берём более “чувствительный” диапазон:
            // примерно -70..-20 (обычная речь/системный звук). Иначе на тихом звуке индикатор почти нулевой.
            const amp01raw = Math.max(0, Math.min(1, (lufs + 70) / 50));

            const prev = Number(session.native.lastAmp01 ?? 0);
            const amp01 = Math.max(0, Math.min(1, prev * 0.75 + amp01raw * 0.25));
            session.native.lastAmp01 = amp01;

            const now = Date.now();
            const lastAt = Number(session.native.lastVizAtMs ?? 0);
            if (now - lastAt < 50) continue; // не чаще 20fps
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
              let sumSq = 0;
              const n = 200;
              for (let i = 0; i < frame.length; i += 2) {
                const s16 = frame.readInt16LE(i);
                const v = s16 / 32768;
                sumSq += v * v;
              }
              const rms = Math.sqrt(sumSq / n); // 0..1
              // Маппинг RMS->dBFS->0..1 делает визуализацию заметной даже на тихих уровнях.
              // db ~= [-inf..0], берём диапазон -60..-12 dBFS.
              const db = 20 * Math.log10(Math.max(1e-6, rms));
              const amp01raw = Math.max(0, Math.min(1, (db + 60) / 48));
              const prev = Number(session.native.lastAmp01 ?? 0);
              const amp01 = Math.max(0, Math.min(1, prev * 0.75 + amp01raw * 0.25));
              session.native.lastAmp01 = amp01;

              const now = Date.now();
              const lastAt = Number(session.native.lastVizAtMs ?? 0);
              if (now - lastAt >= 25) {
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
    for (const mic of micCandidates) {
      for (const m of monitorCandidates) {
        proc = await trySpawn(mic, m);
        if (proc) {
          pickedMic = mic;
          pickedMonitor = m;
          break;
        }
      }
      if (proc) break;
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
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const name = `${session.filePrefix}-${ts}.${session.native.ext}`;
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
          const ext = (session.mimeType || "").includes("ogg") ? "ogg" : "webm";
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
          const ts = new Date().toISOString().replace(/[:.]/g, "-");
          const name = `${filePrefix}-${ts}.${ext}`;
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
      let files: string[] = [];
      if (raw.startsWith("[")) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) files = parsed.map((x) => String(x));
        } catch {
          files = [];
        }
      }

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
    const filePrefix = params.eventKey ? params.eventKey.replace(/[^a-zA-Z0-9._:-]+/g, "_") : "manual";

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
        if (now - s.lastChunkAtMs < s.chunkEveryMs) return;
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
            const amp01 = Math.max(0, Math.min(1, rms * 2.2));
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
      if (now - session.lastChunkAtMs < session.chunkEveryMs) return;
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
        if (now - s.lastChunkAtMs < s.chunkEveryMs) return;
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

