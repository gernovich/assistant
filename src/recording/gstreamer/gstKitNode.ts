import { spawn } from "node:child_process";
import * as path from "node:path";

type Logger = {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

export type GstKitRecordWorkerMsg =
  | { type: "started"; actualMic: string; actualMonitor: string; outPath: string }
  | { type: "level"; micDb: number | null; monitorDb: number | null; ts: number }
  | { type: "stopped"; outPath: string; ts: number }
  | { type: "error"; message: string; details?: unknown };

export type GstKitRecordProcess = {
  stop: () => void;
  waitExit: () => Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
};

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

/**
 * Перевод dBFS (обычно отрицательное число) в 0..1 для визуализации.
 * Без сглаживания: сглаживание делает `RecordingVizNormalizer`.
 */
export function amp01FromDbfs(db: number | null | undefined): number {
  if (db == null || !Number.isFinite(db)) return 0;
  // -60 dBFS -> 0, 0 dBFS -> 1
  const lin = (db + 60) / 60;
  // слегка подчёркиваем тихие уровни
  return clamp01(Math.pow(clamp01(lin), 0.55));
}

export function startGstKitRecordWorker(params: {
  pluginDirPath: string;
  nodeBinary?: string;
  micSource: string; // "auto" | "default" | pulse name
  monitorSource: string; // "auto" | "default" | "" | pulse monitor name
  outFsPath: string; // абсолютный путь на FS (внутри vault)
  processingMic: "none" | "normalize" | "voice";
  processingMonitor: "none" | "normalize" | "voice";
  levelIntervalMs: number;
  onMessage?: (m: GstKitRecordWorkerMsg) => void;
  log: Logger;
}): GstKitRecordProcess {
  const node = params.nodeBinary || process.env.ASSISTANT_NODE_BINARY || "node";
  const workerPath = path.resolve(params.pluginDirPath, "gst-record-worker.cjs");
  const child = spawn(
    node,
    [
      workerPath,
      String(params.micSource || "auto"),
      String(params.monitorSource || "auto"),
      String(params.outFsPath),
      String(params.processingMic || "none"),
      String(params.processingMonitor || "none"),
      String(Math.max(10, Math.floor(params.levelIntervalMs || 100))),
    ],
    {
      cwd: params.pluginDirPath,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  let stdoutBuf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuf += String(chunk || "");
    let idx: number;
    while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as GstKitRecordWorkerMsg;
        params.onMessage?.(msg);
      } catch (e) {
        params.log.warn("GStreamer: не удалось распарсить строку worker stdout", { line, error: String(e) });
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    const s = String(chunk || "").trim();
    if (!s) return;
    params.log.warn("GStreamer worker stderr", { stderr: s });
  });

  const waitExit = async () => {
    const r = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    return r;
  };

  const stop = () => {
    try {
      child.stdin.write("stop\n");
    } catch {
      // ignore
    }
  };

  return { stop, waitExit };
}

