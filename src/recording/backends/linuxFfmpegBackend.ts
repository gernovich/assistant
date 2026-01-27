import { Notice, normalizePath } from "obsidian";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { execFile as execFileNode } from "node:child_process";

import type { AssistantSettings } from "../../types";
import type { LinuxNativeSession } from "../recordingSessionTypes";

import { commandExists } from "../../os/commandExists";

import { appendRollingText, splitLinesKeepRemainder } from "../../domain/policies/rollingTextBuffer";
import { recordingChunkFileName } from "../../domain/policies/recordingFileNaming";
import { linuxNativeFilterGraphPolicy } from "../../domain/policies/ffmpegFilterGraph";
import { linuxNativeFfmpegArgsPolicy } from "../../domain/policies/linuxNativeFfmpegArgs";
import { buildLinuxNativeSourceAttemptPlan } from "../../domain/policies/linuxNativeSourcePlan";
import { buildPulseMicCandidates, parsePactlDefaultSourceFromInfo } from "../../domain/policies/pactl";
import { parseMomentaryLufsFromEbur128Line } from "../../domain/policies/ebur128";
import { amp01FromLufsPolicy, amp01FromRmsPolicy } from "../../domain/policies/recordingVizAmp";
import { rms01FromS16leMonoFrame } from "../../domain/policies/pcmRms";
import { trimForLogPolicy } from "../../domain/policies/logText";

type Logger = {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

async function waitMs(ms: number): Promise<void> {
  return await new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function execShell(cmd: string, timeoutMs = 2000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    execFileNode("sh", ["-lc", cmd], { timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

function trimForLog(v: unknown, max = 1200): string {
  return trimForLogPolicy(v, max);
}

export class LinuxFfmpegBackend {
  constructor(
    private params: {
      getSettings: () => AssistantSettings;
      isActiveSession: (s: LinuxNativeSession) => boolean;
      getOnViz: () => ((amp01: number) => void) | undefined;
      log: Logger;
      writeBinary: (path: string, data: ArrayBuffer) => Promise<void>;
      onFileSaved?: (recordingFilePath: string) => void;
    },
  ) {}

  private get settings(): AssistantSettings {
    return this.params.getSettings();
  }

  private linuxNativeFilterGraph(
    processing: "none" | "normalize" | "voice",
    wantVizPcm: boolean,
  ): { withMonitor: string; micOnly: string; withMonitorViz?: string; micOnlyViz?: string } {
    return linuxNativeFilterGraphPolicy(processing, wantVizPcm);
  }

  private async ensureFfmpegOrReject(): Promise<void> {
    const ok = await commandExists("ffmpeg");
    if (ok) return;
    try {
      new Notice("Ассистент: Linux Native — не найден ffmpeg (установите ffmpeg)");
    } catch {
      // Игнорируем ошибки показа Notice.
    }
    return await Promise.reject("ffmpeg не найден");
  }

  private async guessPulseMicSource(): Promise<string[]> {
    // Авто-детект источника микрофона (источник по умолчанию) для PulseAudio/PipeWire-Pulse.
    const candidates: string[] = [];
    if (await commandExists("pactl")) {
      const info = await execShell("pactl info 2>/dev/null");
      if (this.settings.debug?.enabled) {
        this.params.log.info("Linux Native: pactl info (для микрофона)", {
          ok: info.ok,
          stdout: trimForLog(info.stdout, 900),
          stderr: trimForLog(info.stderr, 300),
        });
      }
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

  private async guessPulseMonitorSource(): Promise<string[]> {
    // Пока оставляем прежние алиасы (как резерв), чтобы не менять поведение.
    // Точный выбор monitor-кандидатов исторически зависит от парсинга pactl и эвристик;
    // этот кусок будет выделен отдельной политикой/адаптером позже.
    const out: string[] = [];
    if (!(await commandExists("pactl"))) return ["@DEFAULT_MONITOR@", "default.monitor"];

    // Базовый путь: оставляем прежние алиасы, но логируем источники (для диагностики).
    try {
      const srcList = await execShell("pactl list short sources 2>/dev/null");
      if (this.settings.debug?.enabled) {
        this.params.log.info("Linux Native: pactl list short sources (источники)", {
          ok: srcList.ok,
          stdout: trimForLog(srcList.stdout, 1200),
          stderr: trimForLog(srcList.stderr, 400),
        });
      }
      // На этом инкременте сохраняем прежний порядок алиасов (важно для совместимости),
      // добавляя только дефолтные, если удастся их угадать.
      out.push("@DEFAULT_MONITOR@", "default.monitor");
      if (!srcList.ok) return out;
      // Небольшой хак: если источники уже содержат "@DEFAULT_MONITOR@" — оставим только один раз.
    } catch {
      out.push("@DEFAULT_MONITOR@", "default.monitor");
    }

    const seen = new Set<string>();
    return out.filter((x) => {
      const k = String(x ?? "").trim();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  async startChunk(session: LinuxNativeSession): Promise<void> {
    await this.ensureFfmpegOrReject();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { spawn } = require("child_process") as typeof import("child_process");
    const dir = await fs.mkdtemp(`${os.tmpdir()}/assistant-rec-`);
    const tmpPath = `${dir}/chunk.ogg`;

    session.native.stderrTail = "";
    session.native.tmpPath = tmpPath;
    session.currentFileStartedAtMs = Date.now();

    const micCandidates = await this.guessPulseMicSource();
    const monitorCandidates = await this.guessPulseMonitorSource();
    if (this.settings.debug?.enabled) {
      this.params.log.info("Linux Native: кандидаты источников", {
        micCandidates,
        monitorCandidates: monitorCandidates.slice(0, 30),
      });
    }

    const trySpawn = async (micName: string, monitorName: string | null): Promise<import("child_process").ChildProcess | null> => {
      const wantViz = Boolean(this.params.getOnViz());
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

      if (this.settings.debug?.enabled) {
        this.params.log.info("Linux Native: запуск ffmpeg", {
          micName,
          monitorName,
          out: tmpPath,
          args: args.join(" "),
        });
      }

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
        const stopAt = Number(session.native.stopRequestedAtMs ?? 0);
        const isLikelyStop = stopAt > 0 && Date.now() - stopAt < 15_000;
        const payload = { code, signal, stderrTail: trimForLog(session.native.stderrTail, 1600) };
        if (isLikelyStop) this.params.log.info("Linux Native: ffmpeg завершился (похоже на стоп)", payload);
        else this.params.log.warn("Linux Native: ffmpeg завершился", payload);
      });

      proc.stderr?.on("data", (buf: Buffer) => {
        const s = String(buf ?? "");
        session.native.stderrTail = appendRollingText({ prev: session.native.stderrTail, chunk: s, maxChars: 2000 });

        // Резерв визуализации: парсим ebur128 из stderr.
        try {
          session.native.vizBuf = appendRollingText({ prev: String(session.native.vizBuf ?? ""), chunk: s, maxChars: 8000 });
          const { lines, remainder } = splitLinesKeepRemainder(session.native.vizBuf);
          session.native.vizBuf = remainder;
          for (const line of lines) {
            const lufs = parseMomentaryLufsFromEbur128Line(line);
            if (lufs == null) continue;
            const amp01 = amp01FromLufsPolicy(lufs);
            session.native.lastAmp01 = amp01;

            if (this.params.isActiveSession(session) && session.status !== "paused") {
              this.params.getOnViz()?.(amp01);
            }
          }
        } catch (e) {
          const now = Date.now();
          const last = Number(session.native.lastVizParseErrAtMs ?? 0);
          if (now - last > 5000) {
            session.native.lastVizParseErrAtMs = now;
            this.params.log.warn("Linux Native: ошибка парсинга метрик уровня из stderr ffmpeg", {
              error: e,
              stderrTail: trimForLog(session.native.stderrTail, 900),
            });
          }
        }
      });

      // Основной путь визуализации: PCM со stdout.
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
              const { amp01raw } = amp01FromRmsPolicy(rms);
              const amp01 = amp01raw;
              session.native.lastAmp01 = amp01;

              if (this.params.isActiveSession(session) && session.status !== "paused") this.params.getOnViz()?.(amp01);
            }
            session.native.vizPcmBuf = off ? buf.subarray(off) : buf;
          } catch (e) {
            const now = Date.now();
            const last = Number(session.native.lastVizParseErrAtMs ?? 0);
            if (now - last > 5000) {
              session.native.lastVizParseErrAtMs = now;
              this.params.log.warn("Linux Native: ошибка парсинга PCM для визуализации", { error: e });
            }
          }
        });
      }

      const exitedQuickly = await Promise.race([
        new Promise<boolean>((resolve) => proc.once("exit", () => resolve(true))),
        waitMs(300).then(() => false),
      ]);
      if (exitedQuickly) {
        this.params.log.warn("Linux Native: ffmpeg завершился сразу (невалидный источник/маршрутизация?)", {
          micName,
          monitorName,
          stderrTail: trimForLog(session.native.stderrTail, 1200),
        });
        try {
          proc.kill("SIGKILL");
          
        } catch (e) {
          this.params.log.warn("Linux Native: не удалось остановить ffmpeg (SIGKILL) после быстрого выхода", { error: e });
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
      try {
        new Notice("Ассистент: Linux Native — не удалось подключить системный звук (monitor). Проверьте PipeWire/Pulse monitor-источник.");
      } catch {
        // Игнорируем ошибки показа Notice.
      }
      this.params.log.error("Linux Native: не удалось стартовать ffmpeg с monitor-источником", {
        micCandidates,
        monitorCandidates: monitorCandidates.slice(0, 20),
        stderrTail: trimForLog(session.native.stderrTail, 1600),
      });
      return await Promise.reject(`linux_native: cannot start with monitor. stderrTail=${session.native.stderrTail}`);
    }

    session.native.proc = proc;
    session.native.monitorName = pickedMonitor;
    this.params.log.info("Linux Native: запись стартовала", { pickedMic, pickedMonitor, tmpPath });
  }

  async stopProc(session: LinuxNativeSession): Promise<void> {
    const proc = session.native.proc;
    if (!proc) return;

    const waitExit = new Promise<void>((resolve) => {
      proc.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
        this.params.log.info("Linux Native: ffmpeg закрыт", { code, signal });
        resolve();
      });
      proc.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
        this.params.log.info("Linux Native: ffmpeg завершился (стоп)", { code, signal });
        resolve();
      });
    });

    try {
      session.native.stopRequestedAtMs = Date.now();
      if (proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.write("q");
        proc.stdin.end();
      }
    } catch (e) {
      this.params.log.warn("Linux Native: не удалось отправить 'q' в stdin ffmpeg", { error: e });
    }

    try {
      proc.kill("SIGINT");
    } catch (e) {
      this.params.log.warn("Linux Native: не удалось послать SIGINT ffmpeg", { error: e });
    }

    await Promise.race([waitExit, waitMs(8000)]);
    if ((proc as any).exitCode == null) {
      try {
        proc.kill("SIGKILL");
      } catch (e) {
        this.params.log.warn("Linux Native: не удалось послать SIGKILL ffmpeg", { error: e });
      }
      await Promise.race([waitExit, waitMs(2000)]);
    }

    session.native.proc = null;
  }

  async finalizeFile(session: LinuxNativeSession): Promise<void> {
    await this.stopProc(session);
    const tmpPath = session.native.tmpPath;
    if (!tmpPath) return;
    session.native.tmpPath = null;

    const recordingsDir = normalizePath(session.recordingsDir);
    const p = (async () => {
      try {
        try {
          const st = await fs.stat(tmpPath);
          this.params.log.info("Linux Native: размер временного файла", { tmpPath, size: st.size });
        } catch (e) {
          this.params.log.error("Linux Native: временный файл отсутствует (ffmpeg не создал выход?)", {
            tmpPath,
            error: e,
            stderrTail: trimForLog(session.native.stderrTail, 1600),
            monitorName: session.native.monitorName,
          });
          return;
        }

        const buf = await fs.readFile(tmpPath);
        if (!buf || buf.byteLength === 0) return;

        const name = recordingChunkFileName({ prefix: session.filePrefix, iso: new Date().toISOString(), ext: session.native.ext });
        const path = normalizePath(`${recordingsDir}/${name}`);

        await this.params.writeBinary(path, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        this.params.onFileSaved?.(path);
      } catch (e) {
        this.params.log.error("Linux Native: ошибка финализации файла (чтение/сохранение/добавление)", { error: e, tmpPath });
      } finally {
        try {
          await fs.rm(tmpPath, { force: true });
          await fs.rm(tmpPath.replace(/\/chunk\.ogg$/, ""), { recursive: true, force: true });
        } catch (e) {
          this.params.log.warn("Linux Native: не удалось удалить временные файлы", { error: e, tmpPath });
        }
      }
    })();

    session.pendingWrites.add(p);
    void p.finally(() => session.pendingWrites.delete(p));
  }
}
