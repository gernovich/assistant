/**
 * Policy: отображение статуса участия (PARTSTAT) в человекочитаемый label (RU).
 *
 * Чистые функции, без зависимостей от календаря/Obsidian.
 */

export type PartstatLabel = "придёт" | "не придёт" | "возможно" | "не указал";

export function partstatLabelRu(partstat: string | undefined | null): PartstatLabel {
  const ps = String(partstat ?? "")
    .trim()
    .toUpperCase();
  if (ps === "ACCEPTED") return "придёт";
  if (ps === "DECLINED") return "не придёт";
  if (ps === "TENTATIVE") return "возможно";
  return "не указал";
}

