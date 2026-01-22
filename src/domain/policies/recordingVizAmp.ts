/**
 * Policy: преобразование метрик уровня звука в amp01 (0..1) + сглаживание.
 */

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Exponential smoothing: prev*(1-alpha) + raw*alpha */
export function smoothAmp01Policy(params: { prev: number; raw: number; alpha: number }): number {
  const prev = Number(params.prev) || 0;
  const raw = Number(params.raw) || 0;
  const a = clamp01(Number(params.alpha));
  return clamp01(prev * (1 - a) + raw * a);
}

/** Mapping for ebur128 momentary loudness M: LUFS -> 0..1 using range ~[-70..-20]. */
export function amp01FromLufsPolicy(lufs: number): number {
  const x = (Number(lufs) + 70) / 50;
  return clamp01(x);
}

/** RMS (0..1) -> dBFS -> 0..1 using range ~[-60..-12]. */
export function amp01FromRmsPolicy(rms01: number): { db: number; amp01raw: number } {
  const rms = Math.max(1e-6, Number(rms01) || 0);
  const db = 20 * Math.log10(rms);
  const amp01raw = clamp01((db + 60) / 48);
  return { db, amp01raw };
}

/** Electron visualizer uses time-domain RMS scaled by factor (default 2.2) and clamped to 0..1. */
export function amp01FromTimeDomainRmsPolicy(rms01: number, scale = 2.2): number {
  const rms = Math.max(0, Number(rms01) || 0);
  const s = Number(scale) || 0;
  return clamp01(rms * s);
}
