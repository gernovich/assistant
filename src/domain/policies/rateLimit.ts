/**
 * Policy: простая проверка rate-limit (не чаще intervalMs).
 */
export function shouldEmitByInterval(params: { nowMs: number; lastAtMs: number; intervalMs: number }): boolean {
  const now = Number(params.nowMs) || 0;
  const last = Number(params.lastAtMs) || 0;
  const interval = Math.max(0, Number(params.intervalMs) || 0);
  return now - last >= interval;
}
