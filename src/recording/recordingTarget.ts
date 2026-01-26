import type { Event } from "../types";
import { pickDefaultRecordingTargetPolicy, type RecordingTarget } from "../domain/policies/recordingTarget";

/**
 * Выбор события по умолчанию для диалога записи:
 * - если есть событие, которое уже идёт (now между start..end) — выбираем его
 * - иначе если есть событие, которое начнётся в ближайшие `minutesWindow` минут — выбираем его
 * - иначе ставим галочку "новый протокол"
 */
export function pickDefaultRecordingTarget(events: Event[], now: Date, minutesWindow = 5): RecordingTarget {
  return pickDefaultRecordingTargetPolicy(events, now, minutesWindow);
}
