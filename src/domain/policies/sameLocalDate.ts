/** Policy: сравнить две даты по локальному календарному дню (YYYY-MM-DD). */
export function sameLocalDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
