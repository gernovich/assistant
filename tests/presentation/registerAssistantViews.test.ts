import { describe, expect, it } from "vitest";
import { registerAssistantViews } from "../../src/presentation/obsidian/views/registerAssistantViews";
import { AGENDA_VIEW_TYPE } from "../../src/views/agendaView";
import { LOG_VIEW_TYPE } from "../../src/views/logView";

describe("registerAssistantViews", () => {
  it("регистрирует agenda/log view types", () => {
    const types: string[] = [];
    const plugin = {
      registerView: (type: string, _creator: unknown) => {
        types.push(type);
      },
    } as any;

    registerAssistantViews(
      plugin,
      { settings: {} as any, calendarService: {} as any, logService: {} as any },
      {
        openLog: () => {},
        openAgenda: () => {},
        openEvent: () => {},
        setMyPartstat: async () => {},
        getProtocolMenuState: async () => ({ hasCurrent: false, hasLatest: false, currentIsLatest: false }),
        openCurrentProtocol: async () => {},
        openLatestProtocol: async () => {},
        createProtocol: async () => {},
        openRecorder: async () => {},
        debugShowReminder: () => {},
        openTodayLog: () => {},
        clearTodayLogFile: () => {},
      },
    );

    expect(types).toContain(AGENDA_VIEW_TYPE);
    expect(types).toContain(LOG_VIEW_TYPE);
  });
});

