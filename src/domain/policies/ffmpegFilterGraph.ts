/**
 * Политика: генерация ffmpeg filtergraph для Linux native записи (mic/monitor + normalize/voice).
 *
 * Чистая функция: возвращает строки фильтров, без выполнения команд.
 */
export function linuxNativeFilterGraphPolicy(
  processing: "none" | "normalize" | "voice",
  wantVizPcm: boolean,
): {
  withMonitor: string;
  micOnly: string;
  withMonitorViz?: string;
  micOnlyViz?: string;
} {
  // Важно: запись Linux Native может включать mic+monitor. Шумодав после микса может портить системный звук,
  // поэтому "voice" обрабатывает только mic-вход до amix.
  const postNormalize = "loudnorm=I=-16:TP=-1.5:LRA=11:linear=true,alimiter=limit=0.97";
  const micVoice = "highpass=f=80,lowpass=f=12000,afftdn=nf=-25";
  // Важно для стабильности: приводим оба входа к одному формату/частоте/каналам ДО микса.
  const prep = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,aresample=48000";
  // Фолбек-метр: ebur128 печатает строки во время записи.
  const meter = "ebur128=peak=true:framelog=info,anullsink";
  // Для плавной визуализации: финальный микс -> mono 8kHz -> блоки ~25ms
  const vizPcm = "aresample=8000,aformat=sample_fmts=s16:channel_layouts=mono,asetnsamples=n=200:p=0";

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
