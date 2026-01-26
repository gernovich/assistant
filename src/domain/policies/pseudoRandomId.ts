/**
 * Политика: генерация "псевдо-случайных" идентификаторов.
 *
 * Важно: сама функция чистая и детерминированная, поэтому `nowMs/randomHex`
 * должны передаваться снаружи (инфраструктура/вызов).
 */
export function makePseudoRandomId(params: { prefix: string; nowMs: number; randomHex: string }): string {
  const prefix = String(params.prefix ?? "").trim() || "id";
  const nowMs = Number(params.nowMs);
  const randomHex = String(params.randomHex ?? "").trim();
  return `${prefix}-${nowMs.toString(36)}-${randomHex || "0"}`;
}
