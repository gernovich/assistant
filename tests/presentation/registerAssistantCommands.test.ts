import { describe, expect, it, vi } from "vitest";
import { registerAssistantCommands } from "../../src/presentation/obsidian/commands/registerAssistantCommands";

describe("registerAssistantCommands", () => {
  it("регистрирует ключевые команды с ожидаемыми id", () => {
    const added: Array<{ id: string; name: string }> = [];
    const plugin = {
      addCommand: (cmd: { id: string; name: string; callback: () => void }) => {
        added.push({ id: cmd.id, name: cmd.name });
      },
    } as any;

    const controller = {
      openAgenda: vi.fn(),
      openRecordingDialog: vi.fn(),
      runTranscriptionNow: vi.fn(),
      refreshCalendars: vi.fn(),
      createMeetingCard: vi.fn(),
      createProtocolCard: vi.fn(),
      createProtocolFromOpenMeeting: vi.fn(),
      createPersonCard: vi.fn(),
      createProjectCard: vi.fn(),
      createPeopleFromAttendees: vi.fn(),
      applyOutbox: vi.fn(),
      eventStatusAccepted: vi.fn(),
      eventStatusDeclined: vi.fn(),
      eventStatusTentative: vi.fn(),
      eventStatusNeedsAction: vi.fn(),
      applyStatusFromMeetingNote: vi.fn(),
      createProtocolFromActiveEvent: vi.fn(),
    } as any;

    registerAssistantCommands(plugin, controller);

    const ids = added.map((x) => x.id);
    expect(ids).toContain("open-agenda");
    expect(ids).toContain("recording-open-dialog");
    expect(ids).toContain("transcription-run-now");
    expect(ids).toContain("refresh-calendars");
    expect(ids).toContain("apply-outbox");
  });
});
