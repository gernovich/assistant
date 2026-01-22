/**
 * Policy именования файла встречи (карточки события).
 *
 * Важно: это pure-функция и не зависит от Obsidian/Vault.
 * Конкретную реализацию "sanitize" передаём снаружи (infrastructure/shared).
 */

export function meetingNoteBaseName(params: {
  summary: string;
  sanitizeFileName: (s: string) => string;
  maxLen?: number;
}): string {
  const maxLen = Math.max(1, Math.floor(Number(params.maxLen ?? 80)));
  const raw = String(params.summary ?? "");
  const sanitized = params.sanitizeFileName(raw);
  return sanitized.slice(0, maxLen);
}

