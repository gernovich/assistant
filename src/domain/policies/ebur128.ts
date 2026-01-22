/**
 * Policy: парсинг ebur128 из stderr ffmpeg.
 *
 * В текущем пайплайне нас интересует momentary loudness `M: -28.3` (LUFS).
 */
export function parseMomentaryLufsFromEbur128Line(line: string): number | null {
  const s = String(line ?? "");
  const m = s.match(/\bM:\s*([-\d.]+)\b/);
  if (!m?.[1]) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

