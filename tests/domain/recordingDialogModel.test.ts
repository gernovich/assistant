import { describe, expect, it } from "vitest";
import type { Calendar, Event } from "../../src/types";
import { buildRecordingDialogModelPolicy } from "../../src/domain/policies/recordingDialogModel";

function cal(id: string): Calendar {
  return { id, name: id, type: "ics_url", config: { id, name: id, type: "ics_url", enabled: true } as any };
}

function ev(params: { calId: string; id: string; start: string; end?: string; summary?: string }): Event {
  return {
    calendar: cal(params.calId),
    id: params.id,
    summary: params.summary ?? params.id,
    start: new Date(params.start),
    end: params.end ? new Date(params.end) : undefined,
  };
}

describe("domain/policies/recordingDialogModel", () => {
  it("фильтрует будущие occurrences и сортирует по start", () => {
    const nowMs = new Date("2026-01-21T10:00:00.000Z").getTime();
    const events = [
      ev({ calId: "c", id: "b", start: "2026-01-21T10:10:00.000Z", summary: "S2" }),
      ev({ calId: "c", id: "a", start: "2026-01-21T10:05:00.000Z", summary: "S1" }),
      ev({ calId: "c", id: "past", start: "2026-01-21T09:00:00.000Z", summary: "P" }),
    ];
    const m = buildRecordingDialogModelPolicy({
      events,
      nowMs,
      defaultEventKey: "",
      lockDefaultEvent: false,
      autoStartSeconds: 5,
      keyOfEvent: (e) => `${e.calendar.id}:${e.id}`,
      labelOfEvent: (e) => `L:${e.id}`,
    });
    expect(m.occurrences.map((x) => x.key)).toEqual(["c:a", "c:b"]);
  });

  it("включает preferred, если он залочен, даже если уже в прошлом", () => {
    const nowMs = new Date("2026-01-21T10:00:00.000Z").getTime();
    const events = [ev({ calId: "c", id: "past", start: "2026-01-21T09:00:00.000Z", summary: "P" })];
    const m = buildRecordingDialogModelPolicy({
      events,
      nowMs,
      defaultEventKey: "c:past",
      lockDefaultEvent: true,
      autoStartSeconds: 5,
      keyOfEvent: (e) => `${e.calendar.id}:${e.id}`,
      labelOfEvent: (e) => `L:${e.id}`,
    });
    expect(m.occurrences.map((x) => x.key)).toEqual(["c:past"]);
    expect(m.lockedLabel).toBe("L:past");
  });
});
