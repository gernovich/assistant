import { partstatLabelRu } from "./partstatLabelRu";

export type AttendeeRenderDto = { email: string; cn?: string; partstat?: string };

/**
 * Политика: рендер списка участников в markdown (RU), как в карточке встречи.
 *
 * Совместимость: формат строк и сортировка должны совпадать с текущим поведением `EventNoteService`.
 */
export function attendeesMarkdownBlockRu(attendees: AttendeeRenderDto[]): string {
  const a = attendees ?? [];
  if (!a.length) return "- (пока не удалось извлечь из календаря)";

  const lines = a
    .slice()
    .sort((x, y) => String(x.email ?? "").localeCompare(String(y.email ?? "")))
    .map((x) => {
      const email = String(x.email ?? "").trim();
      const cn = String(x.cn ?? "").trim();
      const who = cn ? `${cn} <${email}>` : email;
      const label = partstatLabelRu(x.partstat);
      return `- ${who} — ${label}`;
    });

  return lines.join("\n");
}
