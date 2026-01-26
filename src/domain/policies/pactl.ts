/**
 * Политика: парсинг `pactl` stdout (list short / info) и вычисление кандидатов.
 *
 * Все функции чистые: принимают stdout как строку.
 */

export function parsePactlListShortRows(stdout: string): string[][] {
  return String(stdout ?? "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((row) =>
      row
        .split(/\s+/)
        .map((p) => p.trim())
        .filter(Boolean),
    );
}

export function parsePactlDefaultSinkFromInfo(stdout: string): string {
  const m = String(stdout ?? "").match(/^Default Sink:\s*(.+)$/m);
  return (m?.[1] ?? "").trim();
}

export function parsePactlDefaultSourceFromInfo(stdout: string): string {
  const m = String(stdout ?? "").match(/^Default Source:\s*(.+)$/m);
  return (m?.[1] ?? "").trim();
}

export function parsePactlGetDefaultSink(stdout: string): string {
  return (
    String(stdout ?? "")
      .trim()
      .split("\n")[0]
      ?.trim() ?? ""
  );
}

export function parseMonitorSourcesFromListShortSources(stdout: string): {
  monitorSources: Set<string>;
  runningMonitors: string[];
  idleMonitors: string[];
  fallbackFirstMonitors: string[];
} {
  const rows = parsePactlListShortRows(stdout);
  const monitorSources = new Set<string>();
  const runningMonitors: string[] = [];
  const idleMonitors: string[] = [];
  const fallbackFirstMonitors: string[] = [];

  for (const parts of rows) {
    const name = String(parts[1] ?? "").trim();
    const state = String(parts[parts.length - 1] ?? "")
      .trim()
      .toUpperCase();
    if (!name.endsWith(".monitor")) continue;
    monitorSources.add(name);
    fallbackFirstMonitors.push(name);
    if (state === "RUNNING") runningMonitors.push(name);
    else if (state === "IDLE") idleMonitors.push(name);
  }
  return { monitorSources, runningMonitors, idleMonitors, fallbackFirstMonitors };
}

export function parseSinksFromListShortSinks(stdout: string): { sinkIdxToName: Map<string, string>; runningSinks: string[] } {
  const rows = parsePactlListShortRows(stdout);
  const sinkIdxToName = new Map<string, string>();
  const runningSinks: string[] = [];
  for (const parts of rows) {
    const idx = String(parts[0] ?? "").trim();
    const name = String(parts[1] ?? "").trim();
    const state = String(parts[parts.length - 1] ?? "")
      .trim()
      .toUpperCase();
    if (idx && name) sinkIdxToName.set(idx, name);
    if (name && state === "RUNNING") runningSinks.push(name);
  }
  return { sinkIdxToName, runningSinks };
}

export function countSinkInputsFromListShortSinkInputs(stdout: string): Map<string, { running: number; total: number }> {
  const rows = parsePactlListShortRows(stdout);
  const counts = new Map<string, { running: number; total: number }>();
  for (const parts of rows) {
    const sinkIdx = String(parts[1] ?? "").trim();
    const state = String(parts[parts.length - 1] ?? "")
      .trim()
      .toUpperCase();
    if (!sinkIdx) continue;
    const cur = counts.get(sinkIdx) ?? { running: 0, total: 0 };
    cur.total += 1;
    if (state === "RUNNING") cur.running += 1;
    counts.set(sinkIdx, cur);
  }
  return counts;
}

export function rankActiveSinkNames(params: {
  sinkIdxToName: Map<string, string>;
  counts: Map<string, { running: number; total: number }>;
}): string[] {
  return Array.from(params.counts.entries())
    .map(([idx, c]) => ({ name: params.sinkIdxToName.get(idx) ?? "", running: c.running, total: c.total }))
    .filter((x) => Boolean(x.name))
    .sort((a, b) => b.running - a.running || b.total - a.total)
    .map((x) => x.name);
}

export function buildPulseMonitorCandidates(params: {
  sourcesStdout: string;
  sinksStdout?: string;
  sinkInputsStdout?: string;
  defaultSinkFromInfo?: string;
  defaultSinkFromGetDefaultSink?: string;
}): string[] {
  const out: string[] = [];
  const { monitorSources, runningMonitors, idleMonitors, fallbackFirstMonitors } = parseMonitorSourcesFromListShortSources(
    params.sourcesStdout,
  );

  // 1) sink-inputs -> active sink -> <sink>.monitor
  try {
    if (params.sinksStdout && params.sinkInputsStdout) {
      const { sinkIdxToName, runningSinks } = parseSinksFromListShortSinks(params.sinksStdout);
      const counts = countSinkInputsFromListShortSinkInputs(params.sinkInputsStdout);
      const activeSinkNames = rankActiveSinkNames({ sinkIdxToName, counts });
      for (const sinkName of activeSinkNames) {
        const mon = `${sinkName}.monitor`;
        if (monitorSources.has(mon)) out.push(mon);
      }
      // Резерв: RUNNING sinks
      for (const sinkName of runningSinks) {
        const mon = `${sinkName}.monitor`;
        if (monitorSources.has(mon)) out.push(mon);
      }
    }
  } catch {
    // Игнорируем ошибки анализа sinks.
  }

  // 2) RUNNING/IDLE monitor sources
  out.push(...runningMonitors, ...idleMonitors);

  // 3) Default Sink -> .monitor
  const sinkA = String(params.defaultSinkFromInfo ?? "").trim();
  if (sinkA) {
    const mon = `${sinkA}.monitor`;
    if (monitorSources.has(mon)) out.push(mon);
  }
  const sinkB = String(params.defaultSinkFromGetDefaultSink ?? "").trim();
  if (sinkB) {
    const mon = `${sinkB}.monitor`;
    if (monitorSources.has(mon)) out.push(mon);
  }

  // 4) first monitor sources from list (cap 8)
  out.push(...fallbackFirstMonitors.slice(0, 8));

  // 5) PipeWire-Pulse aliases
  out.push("@DEFAULT_MONITOR@", "default.monitor");

  // uniq preserve order
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const c of out) {
    const k = String(c ?? "").trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    uniq.push(k);
  }
  return uniq;
}

export function buildPulseMicCandidates(params: { defaultSourceFromInfo?: string }): string[] {
  const out: string[] = [];
  const src = String(params.defaultSourceFromInfo ?? "").trim();
  if (src) out.push(src);

  // PulseAudio alias
  out.push("@DEFAULT_SOURCE@", "default");

  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const c of out) {
    const k = String(c ?? "").trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    uniq.push(k);
  }
  return uniq;
}
