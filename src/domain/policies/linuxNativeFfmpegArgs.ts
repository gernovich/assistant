/**
 * Policy: сборка аргументов ffmpeg для Linux Native записи (PulseAudio/PipeWire-Pulse).
 *
 * Чистая функция: только формирует args.
 */
export function linuxNativeFfmpegArgsPolicy(params: {
  micName: string;
  monitorName: string | null;
  tmpPath: string;
  wantViz: boolean;
  processing: "none" | "normalize" | "voice";
  filterGraph: { withMonitor: string; withMonitorViz?: string };
}): string[] {
  const micName = String(params.micName ?? "").trim();
  const monitorName = params.monitorName ? String(params.monitorName).trim() : null;
  const tmpPath = String(params.tmpPath ?? "").trim();
  const wantViz = Boolean(params.wantViz);

  const args = ["-hide_banner", "-nostats", "-loglevel", "error"];
  // буфер на входах, чтобы Pulse не ронял/не дропал при кратких пиках нагрузки
  args.push("-thread_queue_size", "1024", "-f", "pulse", "-i", micName);

  if (monitorName) {
    args.push("-thread_queue_size", "1024", "-f", "pulse", "-i", monitorName);
    const graph = wantViz && params.filterGraph.withMonitorViz ? params.filterGraph.withMonitorViz : params.filterGraph.withMonitor;
    args.push("-filter_complex", graph, "-map", "[out]");
  }

  // Output #0: файл (opus/ogg)
  args.push("-ac", "2", "-ar", "48000", "-c:a", "libopus", "-b:a", "96k", "-application", "audio", "-y", tmpPath);

  // Output #1: PCM для визуализации (stdout), только если нужно.
  if (wantViz) {
    args.push("-map", "[viz]", "-f", "s16le", "-ac", "1", "-ar", "8000", "pipe:1");
  }
  return args;
}
