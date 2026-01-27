#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { execSync } = require("node:child_process");

let Gst;
try {
  Gst = require("gst-kit");
} catch (e) {
  console.error("Не найден gst-kit. Установи зависимость: npm i -D gst-kit");
  process.exit(1);
}

// Usage:
//   node scripts/gst-stand.cjs "<mic>" "<monitor(optional)>" "<out.ogg>"
// Env:
//   LEVEL_INTERVAL_MS=100

// Константы/параметры
const mic = process.argv[2] || "default";
const monitorArg = process.argv[3] || "";
const out = process.argv[4] || `/tmp/assistant-stand-${Date.now()}.ogg`;
const levelIntervalMs = Number(process.env.LEVEL_INTERVAL_MS || 100);
const levelIntervalNs = Math.max(10, levelIntervalMs) * 1e6;
const debugLogs = process.env.DEBUG_LOGS === "1";
const processingMic = process.env.PROCESSING_MIC || "voice"; // none | normalize | voice
const processingMon = process.env.PROCESSING_MON || "voice"; // none | normalize | voice
const printIntervalMs = 100;

// Хелперы
function formatMs(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function safeStatSize(path) {
  try {
    return fs.statSync(path).size;
  } catch {
    return 0;
  }
}

function hasElement(name) {
  return Boolean(Gst.Pipeline && typeof Gst.Pipeline.elementExists === "function" && Gst.Pipeline.elementExists(name));
}

function buildProcessingChain(kind) {
  if (kind === "none") return "identity";

  if (!hasElement("webrtcdsp")) {
    throw new Error(`gst-stand: для ${kind} нужен webrtcdsp (gst-plugins-bad)`);
  }

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

function runShell(cmd) {
  try {
    return String(execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }) ?? "");
  } catch {
    return "";
  }
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

function logDebug(message) {
  if (!debugLogs) return;
  process.stderr.write(`${message}\n`);
}

function safeStringify(value) {
  return JSON.stringify(value, (_key, val) => (typeof val === "bigint" ? val.toString() : val));
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

function writeStatusLines({ elapsed, levelMicText, levelMonText, size, record, clear }) {
  if (clear && process.stdout.isTTY && !debugLogs) {
    process.stdout.write("\u001b[5F\u001b[0J");
  }
  process.stdout.write(`Время работы: ${elapsed}\n`);
  process.stdout.write(`Уровень микрофона: ${levelMicText}\n`);
  process.stdout.write(`Уровень монитора: ${levelMonText}\n`);
  process.stdout.write(`Размер: ${size}\n`);
  process.stdout.write(`Время файла: ${record}\n`);
}

function buildPipelineDesc({ micSrc, monSrc, hasMonitor, micProc, monProc, levelIntervalNs, out }) {
  if (hasMonitor) {
    return (
      `${micSrc} ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=1 ! tee name=tmic ` +
      `tmic. ! queue ! level name=level_mic interval=${Math.floor(levelIntervalNs)} ! fakesink sync=false ` +
      `tmic. ! queue ! ${micProc} ! mix. ` +
      `${monSrc} ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=1 ! tee name=tmon ` +
      `tmon. ! queue ! level name=level_mon interval=${Math.floor(levelIntervalNs)} ! fakesink sync=false ` +
      `tmon. ! queue ! ${monProc} ! mix. ` +
      `audiomixer name=mix ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 ! tee name=t ` +
      `t. ! queue ! opusenc bitrate=96000 ! oggmux ! filesink location="${out}"`
    );
  }

  return (
    `${micSrc} ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=1 ! tee name=tmic ` +
    `tmic. ! queue ! level name=level_mic interval=${Math.floor(levelIntervalNs)} ! fakesink sync=false ` +
    `tmic. ! queue ! ${micProc} ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 ! ` +
    `opusenc bitrate=96000 ! oggmux ! filesink location="${out}"`
  );
}

// Пайплайн
const monitor = monitorArg || pickMonitorFromPactl();
const micSrc = mic && mic !== "default" ? `pulsesrc device=${mic}` : "pulsesrc";
const monSrc = monitor && monitor !== "default" ? `pulsesrc device=${monitor}` : "pulsesrc";
const hasMonitor = Boolean(monitor);
const deps = {
  webrtcdsp: hasElement("webrtcdsp"),
  audioloudnorm: hasElement("audioloudnorm"),
  audiolimiter: hasElement("audiolimiter"),
};
console.log(`gst-stand deps: webrtcdsp=${deps.webrtcdsp} audioloudnorm=${deps.audioloudnorm} audiolimiter=${deps.audiolimiter}`);
const micProc = buildProcessingChain(processingMic);
const monProc = buildProcessingChain(processingMon);
const pipelineDesc = buildPipelineDesc({
  micSrc,
  monSrc,
  hasMonitor,
  micProc,
  monProc,
  levelIntervalNs,
  out,
});

const pipeline = new Gst.Pipeline(pipelineDesc);
const levelMic = pipeline.getElementByName ? pipeline.getElementByName("level_mic") : null;
const levelMon = pipeline.getElementByName ? pipeline.getElementByName("level_mon") : null;
if (levelMic) levelMic.setElementProperty("post-messages", true);
if (levelMon) levelMon.setElementProperty("post-messages", true);

console.log(
  `GStreamer stand (gst-kit): mic=${mic} monitor=${monitor || "<none>"} out=${out} processingMic=${processingMic} processingMon=${processingMon}`,
);
console.log("Нажмите любую клавишу для остановки\n");
writeStatusLines({
  elapsed: "-",
  levelMicText: "-",
  levelMonText: "-",
  size: "-",
  record: "-",
  clear: false,
});

// Состояние
let lastDbMic = null;
let lastDbMon = null;
const startAt = Date.now();
let stopAt = null;
let stopSent = false;
let stopTimeout = null;
let finished = false;
let started = false;
let lastPrintAt = 0;
let lastPosMs = 0;

function printStatus() {
  const now = Date.now();
  if (now - lastPrintAt < printIntervalMs) return;
  lastPrintAt = now;
  const elapsedBase = stopAt ?? now;
  const elapsed = formatMs(elapsedBase - startAt);
  const levelMicText = lastDbMic != null ? lastDbMic.toFixed(3) : "-";
  const levelMonText = lastDbMon != null ? lastDbMon.toFixed(3) : "-";
  const size = safeStatSize(out);
  const record = formatMs(lastPosMs);
  writeStatusLines({ elapsed, levelMicText, levelMonText, size, record, clear: true });
}

async function busLoop() {
  while (!stopSent) {
    const msg = await pipeline.busPop(100);
    if (!msg) continue;
    if (msg.type === "error") {
      const err = msg.parseError ? msg.parseError() : msg;
      logDebug(`GStreamer error: ${safeStringify(err)}`);
      stopSent = true;
      stopAt = Date.now();
      break;
    }
    if (msg.type === "eos") {
      stopSent = true;
      stopAt = Date.now();
      break;
    }
    if (msg.type === "async-done" || (msg.type === "state-changed" && msg.newState === "playing")) {
      started = true;
    }
    const rms = getLevelRms(msg);
    if (rms) {
      const db = Number(rms[0]);
      if (!Number.isNaN(db)) {
        if (msg.srcElementName === "level_mic") {
          lastDbMic = db;
        } else if (msg.srcElementName === "level_mon") {
          lastDbMon = db;
        }
      }
    } else if (debugLogs && msg.type === "element") {
      const name = msg.structureName || (msg.structure && msg.structure.name) || "unknown";
      logDebug(`bus msg: type=${msg.type} structure=${name}`);
      logDebug(`bus msg raw: ${safeStringify(msg)}`);
    }
  }
}

// Таймеры
const posTimer = setInterval(() => {
  if (!started) {
    printStatus();
    return;
  }
  const pos = pipeline.queryPosition();
  lastPosMs = pos > 1e6 ? Math.floor(pos / 1e6) : Math.floor(pos * 1000);
  printStatus();
}, 100);

function requestStop() {
  if (stopSent) return;
  stopSent = true;
  stopAt = Date.now();
  if (typeof pipeline.sendEOS === "function") {
    pipeline.sendEOS();
  }
  if (typeof pipeline.stop === "function") {
    pipeline.stop();
  }
  clearInterval(posTimer);
  if (!stopTimeout) {
    stopTimeout = setTimeout(() => {
      pipeline.stop();
      finish(0);
    }, 2000);
  }
}

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();
process.stdin.on("data", (buf) => {
  if (!buf || buf.length === 0) return;
  requestStop();
});

function finish(code = 0) {
  if (finished) return;
  finished = true;
  if (stopTimeout) clearTimeout(stopTimeout);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();
  console.log(`\nФайл: ${out}`);
  process.exitCode = code;
  process.exit();
}

async function main() {
  await pipeline.play();
  await busLoop();
  finish(0);
}

main().catch((err) => {
  console.error("GStreamer error:", err);
  process.exitCode = 1;
});

process.on("exit", () => {
  clearInterval(posTimer);
});

