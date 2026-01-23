/**
 * Policy: безопасное сокращение текста для логов (truncate).
 */
export function trimForLogPolicy(value: unknown, maxChars = 1200): string {
  const text = String(value ?? "");
  const max = Math.max(0, Math.floor(Number(maxChars) || 0));
  if (text.length <= max) return text;
  return text.slice(0, max) + "…(truncated)";
}
