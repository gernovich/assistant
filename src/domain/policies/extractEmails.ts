import { normalizeEmail } from "./normalizeEmail";

/**
 * Policy: извлечь email-адреса из произвольного текста.
 *
 * Зачем: use-case “создать карточки людей из заметки” не должен содержать regex/нормализацию.
 */
export function extractEmailsFromTextPolicy(text: string): string[] {
  const raw = String(text ?? "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return Array.from(new Set(raw.map((x) => normalizeEmail(x)).filter(Boolean)));
}

