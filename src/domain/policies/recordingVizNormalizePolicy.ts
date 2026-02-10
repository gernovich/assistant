/**
 * Политики нормализации уровня звука для визуализации записи.
 * Вся нормализация выполняется только в RecordingVizNormalizer; бэкенды отдают сырые значения (dB или RMS).
 *
 * Цепочка: функция нормализации принимает следующую функцию в цепочке и передаёт ей значение.
 * Композиция: chainSteps([a, b, c]) => (raw) => a(b(c(raw))), т.е. сначала применяется c, затем b, затем a.
 */

/** Результат нормализации: 0..1 для отображения. */
export type RecordingVizNormalizerFn = (raw: number) => number;

/**
 * Шаг цепочки: принимает следующую функцию в цепочке и возвращает нормализатор.
 * Порядок в массиве шагов: первый по индексу применяется к сырому значению последним (после остальных).
 */
export type RecordingVizNormalizerStep = (next: RecordingVizNormalizerFn) => RecordingVizNormalizerFn;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/** Идентичный проход (конец цепочки). */
export const identityVizNormalizer: RecordingVizNormalizerFn = (raw) => clamp01(Number(raw));

/**
 * Собирает цепочку шагов в одну функцию.
 * steps[0] применяется к выходу steps[1](steps[2](...(raw))), т.е. steps[0] — последний по порядку применения.
 */
export function chainVizNormalizerSteps(steps: RecordingVizNormalizerStep[]): RecordingVizNormalizerFn {
  const identity: RecordingVizNormalizerFn = (r) => r;
  return steps.reduceRight<RecordingVizNormalizerFn>((acc, step) => step(acc), identity);
}

/** dBFS (обычно отрицательное) → 0..1. -60 dBFS → 0, 0 dBFS → 1; степень 0.55 подчёркивает тихие уровни. */
export function createDbfsTo01Step(): RecordingVizNormalizerStep {
  return (next) => (raw) => {
    const db = Number(raw);
    if (db == null || !Number.isFinite(db)) return next(0);
    const lin = Math.max(0, Math.min(1, (db + 60) / 60));
    return next(Math.pow(lin, 0.55));
  };
}

/** Ниже порога — 0 (тишина). */
export function createSilenceFloorStep(threshold01: number): RecordingVizNormalizerStep {
  const t = Math.max(0, Math.min(1, Number(threshold01) || 0.02));
  return (next) => (raw) => {
    const v = next(raw);
    return v < t ? 0 : v;
  };
}

/** Масштабирование (для RMS 0..1 от time-domain, например scale 2.2). */
export function createScaleStep(scale: number): RecordingVizNormalizerStep {
  const s = Number(scale) || 1;
  return (next) => (raw) => next(clamp01(Number(raw) * s));
}

/** Для монитора при отсутствии источника: всегда 0. */
export function createConstantStep(value: number): RecordingVizNormalizerStep {
  const v = clamp01(Number(value));
  return () => () => v;
}

/**
 * Нормализация по плавающему пику (stateful): выход = value/peak, peak затухает со временем.
 * Требует контекст времени — не вписывается в чистую (raw)=>number. Вариант: вынести в отдельный
 * stateful-нормализатор внутри RecordingVizNormalizer как опцию. Здесь не реализуем peak в цепочке;
 * при необходимости можно добавить отдельный слой с контекстом.
 */

/** Готовые цепочки для бэкендов. */

/** GStreamer: сырое значение = dB (micDb/monitorDb). */
export function createGStreamerVizPolicy(): RecordingVizNormalizerFn {
  return chainVizNormalizerSteps([createSilenceFloorStep(0.02), createDbfsTo01Step()]);
}

/** Electron Media: сырое значение = RMS 0..1 (time-domain). Монитор не используется — отдельная политика. */
export function createElectronMicVizPolicy(scale = 2.2): RecordingVizNormalizerFn {
  return chainVizNormalizerSteps([createSilenceFloorStep(0.02), createScaleStep(scale)]);
}

/** Монитор в Electron всегда 0. */
export function createElectronMonitorVizPolicy(): RecordingVizNormalizerFn {
  return chainVizNormalizerSteps([createConstantStep(0)]);
}
