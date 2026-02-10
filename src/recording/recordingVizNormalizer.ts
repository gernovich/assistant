import type { RecordingVizNormalizerFn } from "../domain/policies/recordingVizNormalizePolicy";

type RecordingVizNormalizerOptions = {
  /** Функция нормализации: сырое значение (dB, RMS и т.д.) → 0..1. Вся нормализация только здесь. */
  normalizePolicy: RecordingVizNormalizerFn;
  /** Интервал выдачи значений (мс), например 33 для ~30 fps. */
  outputIntervalMs?: number;
  /** Доля, на которую уменьшаем значение при отсутствии новых событий. */
  decayFactor?: number;
  /** Интервал логирования статистики (мс). */
  logIntervalMs?: number;
  /** Логгер для диагностики. */
  onLog?: (message: string) => void;
};

type MinMax = { min: number; max: number };

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function updateMinMax(mm: MinMax | null, v: number): MinMax {
  if (!mm) return { min: v, max: v };
  return { min: Math.min(mm.min, v), max: Math.max(mm.max, v) };
}

/**
 * Нормализатор/буфер для визуализации уровня записи:
 * - принимает сырые значения с любой частотой (dB, RMS и т.д.)
 * - применяет переданную политику нормализации (цепочка шагов) → 0..1
 * - отдаёт значения с заданной частотой (outputIntervalMs)
 * - при отсутствии новых событий снижает значение на decayFactor
 * Вся нормализация (dB→01, порог тишины, масштаб и т.д.) задаётся только политикой.
 */
export class RecordingVizNormalizer {
  private readonly normalizePolicy: RecordingVizNormalizerFn;
  private readonly outputIntervalMs: number;
  private readonly decayFactor: number;
  private readonly logIntervalMs: number;
  private readonly onLog?: (message: string) => void;

  private lastInputAtMs: number | null = null;
  private lastInputValue = 0;
  private lastOutputAtMs: number | null = null;
  private lastOutputValue = 0;

  private inCount = 0;
  private inMinMax: MinMax | null = null;
  private outCount = 0;
  private outMinMax: MinMax | null = null;
  private lastLogAtMs: number | null = null;

  constructor(options: RecordingVizNormalizerOptions) {
    this.normalizePolicy = options.normalizePolicy;
    this.outputIntervalMs = Math.max(5, Number(options.outputIntervalMs ?? 33));
    this.decayFactor = clamp01(Number(options.decayFactor ?? 0.9));
    this.logIntervalMs = Math.max(1, Number(options.logIntervalMs ?? 1000));
    this.onLog = options.onLog;
  }

  /** Принимает сырое значение уровня (dB, RMS и т.д.). */
  push(raw: number, nowMs: number = Date.now()): void {
    const v = clamp01(this.normalizePolicy(Number(raw)));
    this.lastInputAtMs = nowMs;
    this.lastInputValue = v;
    this.inCount += 1;
    this.inMinMax = updateMinMax(this.inMinMax, v);
  }

  /** Возвращает новое значение 0..1, если пришло время выдачи. */
  pull(nowMs: number = Date.now()): number | null {
    const lastOutAt = this.lastOutputAtMs ?? 0;
    if (this.lastOutputAtMs !== null && nowMs - lastOutAt < this.outputIntervalMs) {
      this.maybeLog(nowMs);
      return null;
    }

    const hasNewInput =
      this.lastInputAtMs !== null && (this.lastOutputAtMs === null || this.lastInputAtMs > this.lastOutputAtMs);
    const out = hasNewInput ? this.lastInputValue : clamp01(this.lastOutputValue * this.decayFactor);

    this.lastOutputAtMs = nowMs;
    this.lastOutputValue = out;
    this.outCount += 1;
    this.outMinMax = updateMinMax(this.outMinMax, out);
    this.maybeLog(nowMs);
    return out;
  }

  reset(): void {
    this.lastInputAtMs = null;
    this.lastInputValue = 0;
    this.lastOutputAtMs = null;
    this.lastOutputValue = 0;
    this.inCount = 0;
    this.inMinMax = null;
    this.outCount = 0;
    this.outMinMax = null;
    this.lastLogAtMs = null;
  }

  pause(nowMs: number = Date.now()): void {
    this.lastOutputAtMs = nowMs;
    this.lastInputAtMs = nowMs;
    this.lastInputValue = 0;
    this.lastOutputValue = 0;
  }

  resume(nowMs: number = Date.now()): void {
    this.lastOutputAtMs = nowMs;
    this.lastInputAtMs = nowMs;
    this.lastInputValue = 0;
    this.lastOutputValue = 0;
  }

  private maybeLog(nowMs: number): void {
    if (!this.onLog) return;
    if (this.lastLogAtMs === null) {
      this.lastLogAtMs = nowMs;
      return;
    }
    if (nowMs - this.lastLogAtMs < this.logIntervalMs) return;
    const inMin = this.inMinMax ? this.inMinMax.min.toFixed(3) : "-";
    const inMax = this.inMinMax ? this.inMinMax.max.toFixed(3) : "-";
    const outMin = this.outMinMax ? this.outMinMax.min.toFixed(3) : "-";
    const outMax = this.outMinMax ? this.outMinMax.max.toFixed(3) : "-";
    this.onLog(
      `Визуализация: нормализация за ${this.logIntervalMs}мс, вход=${this.inCount} (min=${inMin}, max=${inMax}), выход=${this.outCount} (min=${outMin}, max=${outMax})`,
    );
    this.inCount = 0;
    this.inMinMax = null;
    this.outCount = 0;
    this.outMinMax = null;
    this.lastLogAtMs = nowMs;
  }
}
