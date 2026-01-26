import type { Event } from "../../types";

export type RecordingOccurrenceOption = {
  key: string;
  label: string;
  startMs: number;
  endMs: number;
};

export type RecordingDialogModel = {
  occurrences: RecordingOccurrenceOption[];
  meetingNames: string[];
  lockedLabel: string;
  meta: Array<{ key: string; startMs: number; endMs: number }>;
  autoSeconds: number;
};

/**
 * Политика: подготовить данные (без HTML) для диалога записи.
 *
 * Правила:
 * - показываем только будущие occurrences (start > now), но включаем “preferred” если он залочен, даже если уже не будущий
 * - сортируем по start ASC, лимит 200
 * - meetingNames = уникальные summary, отсортированы по ближайшему start
 */
export function buildRecordingDialogModelPolicy(params: {
  events: Event[];
  nowMs: number;
  defaultEventKey: string;
  lockDefaultEvent: boolean;
  autoStartSeconds: unknown;
  keyOfEvent: (ev: Event) => string;
  labelOfEvent: (ev: Event) => string;
}): RecordingDialogModel {
  const defaultKey = String(params.defaultEventKey ?? "").trim();
  const nowMs = Number(params.nowMs) || 0;

  const preferredEv = defaultKey && params.lockDefaultEvent ? params.events.find((ev) => params.keyOfEvent(ev) === defaultKey) : undefined;

  const occurrences = params.events
    .slice()
    .filter((ev) => ev.start.getTime() > nowMs || (preferredEv && ev === preferredEv))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, 200);

  const list: RecordingOccurrenceOption[] = occurrences.map((ev) => {
    const key = params.keyOfEvent(ev);
    const label = params.labelOfEvent(ev);
    const startMs = ev.start.getTime();
    const endMs = ev.end?.getTime() ?? startMs + 60 * 60_000; // резерв: 1 час
    return { key, label, startMs, endMs };
  });

  const nextBySummary = new Map<string, number>();
  for (const ev of occurrences) {
    const summary = String(ev.summary || "").trim();
    if (!summary) continue;
    const t = ev.start.getTime();
    const prev = nextBySummary.get(summary);
    if (prev == null || t < prev) nextBySummary.set(summary, t);
  }
  const meetingNames = Array.from(nextBySummary.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([name]) => name);

  const lockedLabel = list.find((x) => x.key === defaultKey)?.label ?? "";
  const meta = list.map((x) => ({ key: x.key, startMs: x.startMs, endMs: x.endMs }));

  const autoSeconds = Math.max(1, Math.floor(Number(params.autoStartSeconds) || 5));
  return { occurrences: list, meetingNames, lockedLabel, meta, autoSeconds };
}
