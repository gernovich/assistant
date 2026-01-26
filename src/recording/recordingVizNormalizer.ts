type RecordingVizNormalizerOptions = {
  /** Интервал выдачи значений (мс). */
  outputIntervalMs?: number;
  /** Доля, на которую уменьшаем значение при отсутствии новых событий. */
  decayFactor?: number;
  /** Скорость затухания пика в секунду (0..1). */
  peakDecayPerSec?: number;
  /** Минимальный пик, чтобы не делить на ноль. */
  minPeak?: number;
  /** Порог тишины (ниже него считаем, что звука нет). */
  silenceFloor?: number;
  /** Интервал логирования статистики (мс). */
  logIntervalMs?: number;
  /** Логгер для диагностики работы нормализатора. */
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
 * - принимает значения с любой частотой
 * - отдаёт значения с заданной частотой
 * - нормализует амплитуду по плавающему пику
 * - при отсутствии новых событий снижает значение на фиксированную долю
 * - ведёт агрегированную статистику и логирует её с заданной частотой
 */
export class RecordingVizNormalizer {
  private readonly outputIntervalMs: number;
  private readonly decayFactor: number;
  private readonly peakDecayPerSec: number;
  private readonly minPeak: number;
  private readonly silenceFloor: number;
  private readonly logIntervalMs: number;
  private readonly onLog?: (message: string) => void;

  private lastInputAtMs: number | null = null;
  private lastInputValue = 0;
  private lastInputIsSilence = false;
  private lastOutputAtMs: number | null = null;
  private lastOutputValue = 0;

  private peak = 0;
  private peakAtMs: number | null = null;

  private inCount = 0;
  private inMinMax: MinMax | null = null;
  private outCount = 0;
  private outMinMax: MinMax | null = null;
  private lastLogAtMs: number | null = null;

  constructor(options?: RecordingVizNormalizerOptions) {
    this.outputIntervalMs = Math.max(5, Number(options?.outputIntervalMs ?? 33));
    this.decayFactor = clamp01(Number(options?.decayFactor ?? 0.9));
    this.peakDecayPerSec = clamp01(Number(options?.peakDecayPerSec ?? 0.96));
    this.minPeak = Math.max(0.000_001, Number(options?.minPeak ?? 0.000_5));
    this.silenceFloor = clamp01(Number(options?.silenceFloor ?? 0.02));
    this.logIntervalMs = Math.max(1, Number(options?.logIntervalMs ?? 1000));
    this.onLog = options?.onLog;
  }

  /** Принимает событие уровня амплитуды. */
  push(amp01: number, nowMs: number = Date.now()): void {
    const v = clamp01(Number(amp01));
    this.lastInputAtMs = nowMs;
    this.lastInputValue = v;
    this.lastInputIsSilence = v < this.silenceFloor;
    this.inCount += 1;
    this.inMinMax = updateMinMax(this.inMinMax, v);
    if (!this.lastInputIsSilence) this.updatePeakWithInput(v, nowMs);
  }

  /** Возвращает новое значение, если пришло время выдачи. */
  pull(nowMs: number = Date.now()): number | null {
    const lastOutAt = this.lastOutputAtMs ?? 0;
    if (this.lastOutputAtMs !== null && nowMs - lastOutAt < this.outputIntervalMs) {
      this.maybeLog(nowMs);
      return null;
    }

    let out: number;
    const hasNewInput = this.lastInputAtMs !== null && (this.lastOutputAtMs === null || this.lastInputAtMs > this.lastOutputAtMs);
    if (hasNewInput) {
      out = this.lastInputIsSilence ? 0 : this.normalize(this.lastInputValue, nowMs);
    } else {
      out = clamp01(this.lastOutputValue * this.decayFactor);
    }
    if (out < this.silenceFloor) out = 0;

    this.lastOutputAtMs = nowMs;
    this.lastOutputValue = out;
    this.outCount += 1;
    this.outMinMax = updateMinMax(this.outMinMax, out);
    this.maybeLog(nowMs);
    return out;
  }

  /** Сброс состояния и статистики. */
  reset(): void {
    this.lastInputAtMs = null;
    this.lastInputValue = 0;
    this.lastInputIsSilence = false;
    this.lastOutputAtMs = null;
    this.lastOutputValue = 0;
    this.peak = 0;
    this.peakAtMs = null;
    this.inCount = 0;
    this.inMinMax = null;
    this.outCount = 0;
    this.outMinMax = null;
    this.lastLogAtMs = null;
  }

  /** Заморозить тайминг (пауза записи), чтобы после паузы не было рывка. */
  pause(nowMs: number = Date.now()): void {
    this.lastOutputAtMs = nowMs;
    this.peakAtMs = nowMs;
    this.peak = 0;
    this.lastInputAtMs = nowMs;
    this.lastInputValue = 0;
    this.lastInputIsSilence = true;
    this.lastOutputValue = 0;
  }

  /** Возобновить после паузы (сбрасываем тайминг затухания пика). */
  resume(nowMs: number = Date.now()): void {
    this.lastOutputAtMs = nowMs;
    this.peakAtMs = nowMs;
    this.peak = 0;
    this.lastInputAtMs = nowMs;
    this.lastInputValue = 0;
    this.lastInputIsSilence = true;
    this.lastOutputValue = 0;
  }

  private updatePeakWithInput(v: number, nowMs: number): void {
    this.decayPeak(nowMs);
    this.peak = Math.max(this.peak, v, this.minPeak);
  }

  private decayPeak(nowMs: number): void {
    if (this.peakAtMs === null) {
      this.peakAtMs = nowMs;
      return;
    }
    const dtSec = Math.max(0, (nowMs - this.peakAtMs) / 1000);
    if (dtSec > 0) {
      this.peak = this.peak * Math.pow(this.peakDecayPerSec, dtSec);
      if (this.peak < this.minPeak) this.peak = this.minPeak;
      this.peakAtMs = nowMs;
    }
  }

  private normalize(raw: number, nowMs: number): number {
    if (raw <= 0) return 0;
    this.decayPeak(nowMs);
    const peak = Math.max(this.peak, this.minPeak);
    return clamp01(raw / peak);
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
