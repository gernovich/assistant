/**
 * Policy: тайминги чанков записи (rotation).
 */

export function shouldRotateChunkPolicy(params: { nowMs: number; lastChunkAtMs: number; chunkEveryMs: number }): boolean {
  const now = Number(params.nowMs) || 0;
  const last = Number(params.lastChunkAtMs) || 0;
  const every = Math.max(0, Number(params.chunkEveryMs) || 0);
  return Math.max(0, now - last) >= every;
}

export function nextChunkInMsPolicy(params: { nowMs: number; lastChunkAtMs: number; chunkEveryMs: number }): number {
  const now = Number(params.nowMs) || 0;
  const last = Number(params.lastChunkAtMs) || 0;
  const every = Math.max(0, Number(params.chunkEveryMs) || 0);
  return Math.max(0, every - Math.max(0, now - last));
}
