/**
 * Policy: краткая сводка по участникам для tooltip (RU).
 *
 * Важно: чистые функции. Формат строки оставляем совместимым с текущим `AgendaView`:
 * "Принято: N; Отклонено: N; Возможно: N; Нет ответа: N;"
 */

export type AttendeeStatusLike = { partstat?: string };

export type AttendeesPartstatCounts = {
  accepted: number;
  declined: number;
  tentative: number;
  unknown: number;
};

export function countAttendeesPartstat(attendees: AttendeeStatusLike[]): AttendeesPartstatCounts {
  let accepted = 0;
  let declined = 0;
  let tentative = 0;
  let unknown = 0;

  for (const x of attendees ?? []) {
    const ps = String(x?.partstat ?? "")
      .trim()
      .toUpperCase();
    if (ps === "ACCEPTED") accepted++;
    else if (ps === "DECLINED") declined++;
    else if (ps === "TENTATIVE") tentative++;
    else unknown++;
  }

  return { accepted, declined, tentative, unknown };
}

export function attendeesTooltipRu(attendees: AttendeeStatusLike[]): string {
  const a = attendees ?? [];
  if (!a.length) return "";
  const c = countAttendeesPartstat(a);
  const parts: string[] = [];
  if (c.accepted > 0) parts.push(`Принято: ${c.accepted}`);
  if (c.declined > 0) parts.push(`Отклонено: ${c.declined}`);
  if (c.tentative > 0) parts.push(`Возможно: ${c.tentative}`);
  if (c.unknown > 0) parts.push(`Нет ответа: ${c.unknown}`);
  return parts.length ? parts.join("; ") + ";" : "";
}
