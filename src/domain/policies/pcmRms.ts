/**
 * Policy: расчёт RMS из PCM кадра (s16le, mono).
 *
 * Возвращает RMS в диапазоне 0..1.
 */
export function rms01FromS16leMonoFrame(frame: Buffer, samples: number): number {
  const n = Math.max(1, Math.floor(Number(samples) || 0));
  const bytesNeeded = n * 2;
  if (!frame || frame.length < bytesNeeded) return 0;
  let sumSq = 0;
  for (let i = 0; i < bytesNeeded; i += 2) {
    const s16 = frame.readInt16LE(i);
    const v = s16 / 32768;
    sumSq += v * v;
  }
  return Math.sqrt(sumSq / n);
}
