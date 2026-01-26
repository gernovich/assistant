/**
 * Политика: rolling-буфер для текста (append + truncate).
 */
export function appendRollingText(params: { prev: string; chunk: string; maxChars: number }): string {
  const prev = String(params.prev ?? "");
  const chunk = String(params.chunk ?? "");
  const max = Math.max(0, Math.floor(Number(params.maxChars) || 0));
  const next = prev + chunk;
  if (max === 0) return "";
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * Политика: split по CR/LF, оставляя последний неполный хвост в remainder.
 * Полезно для стримов, где строки могут приходить через '\r' без '\n'.
 */
export function splitLinesKeepRemainder(buf: string): { lines: string[]; remainder: string } {
  const s = String(buf ?? "");
  const parts = s.split(/[\r\n]+/);
  const remainder = parts.pop() ?? "";
  return { lines: parts.filter((x) => x !== ""), remainder };
}
