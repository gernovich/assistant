import { describe, expect, it } from "vitest";
import type { Calendar, Event } from "../src/types";
import { pickDefaultRecordingTarget } from "../src/recording/recordingTarget";

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

describe("recordingTarget (compat wrapper)", () => {
  it("selects ongoing event over soon event", () => {
    const now = new Date("2026-01-21T10:00:00.000Z");
    const events = [
      ev({ calId: "c", id: "soon", start: "2026-01-21T10:03:00.000Z", end: "2026-01-21T11:00:00.000Z" }),
      ev({ calId: "c", id: "on", start: "2026-01-21T09:30:00.000Z", end: "2026-01-21T10:30:00.000Z" }),
    ];
    const r = pickDefaultRecordingTarget(events, now, 5);
    expect(r.createNewProtocol).toBe(false);
    expect(r.selectedEventKey).toContain("c:on");
  });

  it("selects soon event within 5 minutes", () => {
    const now = new Date("2026-01-21T10:00:00.000Z");
    const events = [ev({ calId: "c", id: "soon", start: "2026-01-21T10:04:00.000Z" })];
    const r = pickDefaultRecordingTarget(events, now, 5);
    expect(r.createNewProtocol).toBe(false);
    expect(r.selectedEventKey).toContain("c:soon");
  });

  it("defaults to new protocol when nothing ongoing/soon", () => {
    const now = new Date("2026-01-21T10:00:00.000Z");
    const events = [ev({ calId: "c", id: "later", start: "2026-01-21T12:00:00.000Z" })];
    const r = pickDefaultRecordingTarget(events, now, 5);
    expect(r.createNewProtocol).toBe(true);
    expect(r.selectedEventKey).toBeUndefined();
  });
});
