/**
 * Policy: выбор файла карточки встречи (meeting note) без vault I/O.
 *
 * Зачем: отделить "решение" (eventKey vs legacy sid vs create/rename) от выполнения
 * (vault.read/modify/rename/createUniqueMarkdownFile) в `EventNoteService`.
 */

export type MeetingNoteFileDecision =
  | { kind: "use_eventKey"; renameTo?: string }
  | { kind: "use_legacy_sid"; renameTo?: string; shouldIndexEventKey: true }
  | { kind: "create_new"; shouldIndexEventKey: true };

export function decideMeetingNoteFile(params: {
  targetPath: string;
  existingByEventKeyPath?: string | null;
  existingByLegacySidPath?: string | null;
}): MeetingNoteFileDecision {
  const target = String(params.targetPath ?? "").trim();

  const byKey = String(params.existingByEventKeyPath ?? "").trim();
  if (byKey) {
    if (target && byKey !== target) return { kind: "use_eventKey", renameTo: target };
    return { kind: "use_eventKey" };
  }

  const bySid = String(params.existingByLegacySidPath ?? "").trim();
  if (bySid) {
    if (target && bySid !== target) return { kind: "use_legacy_sid", renameTo: target, shouldIndexEventKey: true };
    return { kind: "use_legacy_sid", shouldIndexEventKey: true };
  }

  return { kind: "create_new", shouldIndexEventKey: true };
}
