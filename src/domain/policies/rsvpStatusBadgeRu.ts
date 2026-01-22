import type { RsvpStatus } from "../../types";

/**
 * Policy: отображение RSVP статуса (accepted/declined/...) в badge-текст для UI (RU).
 *
 * Важно: это чистая функция. Формат строки оставляем совместимым с текущим UI `AgendaView` (с ведущим " • ").
 */
export function rsvpStatusBadgeRu(status: RsvpStatus | undefined): string {
  if (status === "accepted") return " • принято";
  if (status === "declined") return " • отклонено";
  if (status === "tentative") return " • возможно";
  if (status === "needs_action") return " • нет ответа";
  return "";
}

