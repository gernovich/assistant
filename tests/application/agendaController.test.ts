import { describe, expect, it, vi } from "vitest";
import type { AssistantSettings, Event } from "../../src/types";
import { DEFAULT_SETTINGS } from "../../src/settingsStore";
import { AgendaController } from "../../src/application/agenda/agendaController";

function makeSettings(maxEvents: number): AssistantSettings {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.agenda.maxEvents = maxEvents;
  return s;
}

function makeFakeEvent(): Event {
  return {
    calendar: { id: "cal", name: "Cal", type: "ics_url", config: { id: "cal", name: "Cal", type: "ics_url", enabled: true, url: "" } },
    id: "ev",
    summary: "Meet",
    start: new Date("2020-01-01T10:00:00Z"),
  };
}

describe("AgendaController", () => {
  it("getDayEvents использует settings.agenda.maxEvents", () => {
    const getDayEvents = vi.fn().mockReturnValue([]);
    const calendarService = {
      onChange: vi.fn().mockReturnValue(() => undefined),
      getRefreshResult: vi.fn().mockReturnValue({ perCalendar: {}, updatedAt: 0, events: [] }),
      getDayEvents,
    } as any;

    const actions = {
      openLog: () => undefined,
      openEvent: () => undefined,
      openRecorder: () => undefined,
      refreshCalendars: () => undefined,
      refreshCalendar: () => undefined,
      setMyPartstat: () => undefined,
      getProtocolMenuState: async () => ({ hasCurrent: false, hasLatest: false, currentIsLatest: false }),
      openCurrentProtocol: () => undefined,
      openLatestProtocol: () => undefined,
      createProtocol: () => undefined,
      debugShowReminder: () => undefined,
    };

    const ctrl = new AgendaController(makeSettings(7), calendarService, actions);
    ctrl.getDayEvents(2);

    expect(getDayEvents).toHaveBeenCalledWith(2, 7);
  });

  it("делегирует действия в actions", async () => {
    const ev = makeFakeEvent();
    const calendarService = {
      onChange: vi.fn().mockReturnValue(() => undefined),
      getRefreshResult: vi.fn().mockReturnValue({ perCalendar: {}, updatedAt: 0, events: [] }),
      getDayEvents: vi.fn().mockReturnValue([ev]),
    } as any;

    const actions = {
      openLog: vi.fn(),
      openEvent: vi.fn(),
      openRecorder: vi.fn(),
      refreshCalendars: vi.fn(),
      refreshCalendar: vi.fn(),
      setMyPartstat: vi.fn(),
      getProtocolMenuState: vi.fn().mockResolvedValue({ hasCurrent: true, hasLatest: true, currentIsLatest: true }),
      openCurrentProtocol: vi.fn(),
      openLatestProtocol: vi.fn(),
      createProtocol: vi.fn(),
      debugShowReminder: vi.fn(),
    };

    const ctrl = new AgendaController(makeSettings(5), calendarService, actions);

    ctrl.openLog();
    ctrl.openEvent(ev);
    await ctrl.openRecorder(ev);
    await ctrl.setMyPartstat(ev, "accepted");
    await ctrl.getProtocolMenuState(ev);
    await ctrl.openCurrentProtocol(ev);
    await ctrl.openLatestProtocol(ev);
    await ctrl.createProtocol(ev);
    ctrl.debugShowReminder(ev);

    expect(actions.openLog).toHaveBeenCalledTimes(1);
    expect(actions.openEvent).toHaveBeenCalledWith(ev);
    expect(actions.openRecorder).toHaveBeenCalledWith(ev);
    expect(actions.setMyPartstat).toHaveBeenCalledWith(ev, "accepted");
    expect(actions.getProtocolMenuState).toHaveBeenCalledWith(ev);
    expect(actions.openCurrentProtocol).toHaveBeenCalledWith(ev);
    expect(actions.openLatestProtocol).toHaveBeenCalledWith(ev);
    expect(actions.createProtocol).toHaveBeenCalledWith(ev);
    expect(actions.debugShowReminder).toHaveBeenCalledWith(ev);
  });
});
