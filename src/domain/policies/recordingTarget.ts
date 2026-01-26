import type { Event } from "../../types";
import { makeOccurrenceKey } from "../../ids/stableIds";

export type RecordingTarget = {
  selectedEventKey?: string;
  createNewProtocol: boolean;
};

/**
 * Политика: выбор события по умолчанию для диалога записи.
 *
 * - если есть событие, которое уже идёт (now между start..end) — выбираем его
 * - иначе если есть событие, которое начнётся в ближайшие `minutesWindow` минут — выбираем его
 * - иначе ставим галочку "новый протокол"
 */
export function pickDefaultRecordingTargetPolicy(
  events: Event[],
  now: Date,
  minutesWindow: number,
): RecordingTarget {
  const nowMs = now.getTime();
  const windowMs = Math.max(0, minutesWindow) * 60_000;

  let ongoing: Event | null = null;
  let soon: Event | null = null;
  let soonDelta = Number.POSITIVE_INFINITY;

  for (const ev of events) {
    const start = ev.start.getTime();
    const end = ev.end?.getTime() ?? start;
    const isOngoing = start <= nowMs && end >= nowMs;
    if (isOngoing) {
      if (!ongoing || start > ongoing.start.getTime()) ongoing = ev;
      continue;
    }
    const delta = start - nowMs;
    if (delta >= 0 && delta <= windowMs) {
      if (delta < soonDelta) {
        soon = ev;
        soonDelta = delta;
      }
    }
  }

  const picked = ongoing ?? soon;
  if (!picked) return { selectedEventKey: undefined, createNewProtocol: true };
  return { selectedEventKey: makeOccurrenceKey(picked.calendar.id, picked.id, picked.start), createNewProtocol: false };
}
