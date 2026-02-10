#!/usr/bin/env node
"use strict";

/**
 * Worker процесс для записи через gst-kit (запускается отдельным `node`, НЕ внутри Obsidian/Electron).
 *
 * Протокол stdout (JSONL):
 * - {"type":"started","actualMic":"...","actualMonitor":"...","outPath":"..."}
 * - {"type":"level","micDb":-23.1,"monitorDb":-41.2,"ts":1730000000000}
 * - {"type":"stopped","outPath":"...","ts":...}
 * - {"type":"error","message":"...","details":{...}}
 *
 * Управление: stdin (ASCII)
 * - "stop\n" -> requestStop()
 */

const { execSync } = require("node:child_process");

let Gst;
try {
  Gst = require("gst-kit");
} catch (e) {
  process.stdout.write(
    JSON.stringify({ type: "error", message: "Не найден gst-kit (require('gst-kit') не сработал)", details: { error: String(e) } }) +
      "\n",
  );
  process.exit(1);
}

function safeStringify(value) {
  return JSON.stringify(value, (_key, val) => (typeof val === "bigint" ? val.toString() : val));
}

function runShell(cmd) {
  try {
    return String(execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }) ?? "");
  } catch {
    return "";
  }
}

function pickMicFromPactl() {
  const sources = runShell("pactl list short sources 2>/dev/null");
  const rows = sources
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((row) => row.split(/\s+/).map((p) => p.trim()));
  const mics = rows
    .map((parts) => ({ name: parts[1] ?? "", state: String(parts[parts.length - 1] ?? "").toUpperCase() }))
    .filter((x) => x.name && !x.name.endsWith(".monitor"));
  const running = mics.find((x) => x.state === "RUNNING");
  if (running) return running.name;
  const idle = mics.find((x) => x.state === "IDLE");
  if (idle) return idle.name;
  return mics[0]?.name ?? "";
}

function pickMonitorFromPactl() {
  const sources = runShell("pactl list short sources 2>/dev/null");
  const rows = sources
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((row) => row.split(/\s+/).map((p) => p.trim()));
  const monitors = rows
    .map((parts) => ({ name: parts[1] ?? "", state: String(parts[parts.length - 1] ?? "").toUpperCase() }))
    .filter((x) => x.name.endsWith(".monitor"));
  const running = monitors.find((x) => x.state === "RUNNING");
  if (running) return running.name;
  const idle = monitors.find((x) => x.state === "IDLE");
  if (idle) return idle.name;
  return monitors[0]?.name ?? "";
}

function hasElement(name) {
  return Boolean(Gst.Pipeline && typeof Gst.Pipeline.elementExists === "function" && Gst.Pipeline.elementExists(name));
}

function buildProcessingChain(kind) {
  if (kind === "none") return "identity";
  // Если нет webrtcdsp — не падаем, чтобы запись в любом случае работала.
  if (!hasElement("webrtcdsp")) return "identity";

  if (kind === "normalize") {
    return (
      "audioconvert ! audioresample ! audio/x-raw,format=S16LE,channels=1,rate=48000 ! " +
      "webrtcdsp echo-cancel=0 gain-control=1 limiter=1 target-level-dbfs=1 compression-gain-db=24"
    );
  }
  if (kind === "voice") {
    return (
      "audioconvert ! audioresample ! audio/x-raw,format=S16LE,channels=1,rate=48000 ! " +
      "webrtcdsp echo-cancel=0 noise-suppression=1 noise-suppression-level=3 " +
      "high-pass-filter=1 gain-control=1 limiter=1 target-level-dbfs=1 compression-gain-db=24"
    );
  }
  return "identity";
}

function extractRmsFromAny(value, depth = 0) {
  if (!value || depth > 4) return null;
  if (Array.isArray(value)) {
    if (value.length > 0 && typeof value[0] === "number") return value;
    return null;
  }
  if (typeof value === "object") {
    if (Array.isArray(value.rms)) return value.rms;
    for (const key of Object.keys(value)) {
      const found = extractRmsFromAny(value[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function getLevelRms(msg) {
  if (!msg) return null;
  const structure = msg.structure || msg.structureValue || msg.value || null;
  const structureName = msg.structureName || (structure && structure.name) || null;
  if (structureName !== "level") return null;
  if (Array.isArray(msg.rms) && msg.rms.length > 0) return msg.rms;
  if (structure) {
    const rms = extractRmsFromAny(structure);
    if (Array.isArray(rms) && rms.length > 0) return rms;
  }
  return null;
}

function clampMixLevel(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0.01) return 1;
  if (n > 2) return 2;
  return n;
}

function buildPipelineDesc({ micSrc, monSrc, hasMonitor, micProc, monProc, levelIntervalNs, out, micMixLevel, monMixLevel }) {
  const micGain = clampMixLevel(micMixLevel);
  const monGain = clampMixLevel(monMixLevel);
  if (hasMonitor) {
    return (
      `${micSrc} ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=1 ! tee name=tmic ` +
      `tmic. ! queue ! level name=level_mic interval=${Math.floor(levelIntervalNs)} ! fakesink sync=false ` +
      `tmic. ! queue ! ${micProc} ! volume volume=${micGain} ! mix. ` +
      `${monSrc} ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=1 ! tee name=tmon ` +
      `tmon. ! queue ! level name=level_mon interval=${Math.floor(levelIntervalNs)} ! fakesink sync=false ` +
      `tmon. ! queue ! ${monProc} ! volume volume=${monGain} ! mix. ` +
      `audiomixer name=mix ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 ! ` +
      `opusenc bitrate=96000 ! oggmux ! filesink location="${out}"`
    );
  }

  return (
    `${micSrc} ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=1 ! tee name=tmic ` +
    `tmic. ! queue ! level name=level_mic interval=${Math.floor(levelIntervalNs)} ! fakesink sync=false ` +
    `tmic. ! queue ! ${micProc} ! volume volume=${micGain} ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 ! ` +
    `opusenc bitrate=96000 ! oggmux ! filesink location="${out}"`
  );
}

const micArg = String(process.argv[2] || "auto");
const monitorArg = String(process.argv[3] || "auto");
const outPath = String(process.argv[4] || "");
const processingMic = String(process.argv[5] || "none");
const processingMon = String(process.argv[6] || "none");
const levelIntervalMs = Math.max(10, Number(process.argv[7] || 100));
const micMixLevel = process.argv[8] != null ? Number(process.argv[8]) : 1;
const monMixLevel = process.argv[9] != null ? Number(process.argv[9]) : 1;

if (!outPath) {
  process.stdout.write(JSON.stringify({ type: "error", message: "outPath обязателен" }) + "\n");
  process.exit(1);
}

const actualMic =
  micArg === "auto" || micArg === "default" || micArg === "" ? pickMicFromPactl() || "default" : micArg;
const actualMonitor =
  monitorArg === "auto" || monitorArg === "default"
    ? pickMonitorFromPactl()
    : monitorArg === ""
      ? ""
      : monitorArg;
const hasMonitor = Boolean(actualMonitor);

// pulsesrc: если default/auto -> без device=, иначе device=<name>
const micSrc = actualMic && actualMic !== "default" ? `pulsesrc device=${actualMic}` : "pulsesrc";
const monSrc = actualMonitor && actualMonitor !== "default" ? `pulsesrc device=${actualMonitor}` : "pulsesrc";

const micProc = buildProcessingChain(processingMic);
const monProc = buildProcessingChain(processingMon);
const levelIntervalNs = levelIntervalMs * 1e6;
const pipelineDesc = buildPipelineDesc({
  micSrc,
  monSrc,
  hasMonitor,
  micProc,
  monProc,
  levelIntervalNs,
  out: outPath.replaceAll('"', '\\"'),
  micMixLevel,
  monMixLevel,
});

let pipeline;
try {
  pipeline = new Gst.Pipeline(pipelineDesc);
} catch (e) {
  process.stdout.write(
    JSON.stringify({ type: "error", message: "Не удалось создать Gst.Pipeline", details: { error: String(e), desc: pipelineDesc } }) +
      "\n",
  );
  process.exit(1);
}

const levelMic = pipeline.getElementByName ? pipeline.getElementByName("level_mic") : null;
const levelMon = pipeline.getElementByName ? pipeline.getElementByName("level_mon") : null;
if (levelMic) levelMic.setElementProperty("post-messages", true);
if (levelMon) levelMon.setElementProperty("post-messages", true);

process.stdout.write(JSON.stringify({ type: "started", actualMic, actualMonitor, outPath }) + "\n");

let lastDbMic = null;
let lastDbMon = null;
let stopSent = false;
let finished = false;
let stopTimeout = null;

async function busLoop() {
  while (!stopSent) {
    const msg = await pipeline.busPop(100);
    if (!msg) continue;
    if (msg.type === "error") {
      const err = msg.parseError ? msg.parseError() : msg;
      process.stdout.write(JSON.stringify({ type: "error", message: "GStreamer error", details: err }) + "\n");
      stopSent = true;
      break;
    }
    if (msg.type === "eos") {
      stopSent = true;
      break;
    }
    const rms = getLevelRms(msg);
    if (rms) {
      const db = Number(rms[0]);
      if (!Number.isNaN(db)) {
        if (msg.srcElementName === "level_mic") lastDbMic = db;
        else if (msg.srcElementName === "level_mon") lastDbMon = db;
      }
      process.stdout.write(
        JSON.stringify({ type: "level", micDb: lastDbMic, monitorDb: lastDbMon, ts: Date.now() }) + "\n",
      );
    }
  }
}

function requestStop() {
  if (stopSent) return;
  stopSent = true;
  try {
    if (typeof pipeline.sendEOS === "function") pipeline.sendEOS();
  } catch {}
  try {
    if (typeof pipeline.stop === "function") pipeline.stop();
  } catch {}
  if (!stopTimeout) {
    stopTimeout = setTimeout(() => {
      try {
        if (typeof pipeline.stop === "function") pipeline.stop();
      } catch {}
      finish(0);
    }, 2000);
  }
}

function finish(code = 0) {
  if (finished) return;
  finished = true;
  if (stopTimeout) clearTimeout(stopTimeout);
  process.stdout.write(JSON.stringify({ type: "stopped", outPath, ts: Date.now() }) + "\n");
  process.exitCode = code;
  process.exit();
}

process.stdin.setEncoding("utf8");
process.stdin.resume();
let stdinBuf = "";
process.stdin.on("data", (chunk) => {
  stdinBuf += String(chunk || "");
  let idx;
  while ((idx = stdinBuf.indexOf("\n")) >= 0) {
    const line = stdinBuf.slice(0, idx).trim();
    stdinBuf = stdinBuf.slice(idx + 1);
    if (line === "stop") requestStop();
  }
});

async function main() {
  await pipeline.play();
  await busLoop();
  finish(0);
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ type: "error", message: "Worker exception", details: { error: String(err) } }) + "\n");
  process.exit(1);
});

