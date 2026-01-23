/**
 * Policy: сортировка списка протоколов "последние сверху".
 * Элементы без `start` уходят в конец.
 */
export function sortProtocolInfosNewestFirst<T extends { start?: Date }>(items: T[]): T[] {
  const out = [...items];
  out.sort((a, b) => {
    const at = a.start?.getTime();
    const bt = b.start?.getTime();
    if (at == null && bt == null) return 0;
    if (at == null) return 1;
    if (bt == null) return -1;
    return bt - at;
  });
  return out;
}
