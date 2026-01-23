import { describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import { ProtocolFromMeetingUseCase } from "../../src/application/protocols/protocolFromMeetingUseCase";

function tfile(path: string): TFile {
  return { path, basename: path.split("/").pop() ?? path } as any;
}

function meetingMd(params?: { calendarId?: string; eventId?: string; start?: string; summary?: string }): string {
  return `---
assistant_type: calendar_event
calendar_id: ${params?.calendarId ?? "cal"}
event_id: ${params?.eventId ?? "uid"}
start: ${params?.start ?? "2020-01-01T10:00:00.000Z"}
summary: ${params?.summary ?? "Meet"}
---
`;
}

describe("ProtocolFromMeetingUseCase", () => {
  it("если нет active file — notice", async () => {
    const notice = vi.fn();
    const uc = new ProtocolFromMeetingUseCase({
      getActiveFile: () => null,
      readFileText: async () => "",
      meetingNotes: { linkProtocol: vi.fn() } as any,
      protocols: { createProtocolFromMeetingFile: vi.fn(), openProtocol: vi.fn() } as any,
      notice,
      log: { info: vi.fn(), warn: vi.fn() },
    });

    await uc.createFromActiveMeeting();
    expect(notice).toHaveBeenCalledWith("Ассистент: откройте карточку встречи");
  });

  it("happy path: создаёт и открывает протокол, линкует если есть event_id", async () => {
    const notice = vi.fn();
    const file = tfile("m.md");
    const protocol = tfile("p.md");

    const createProtocolFromMeetingFile = vi.fn().mockResolvedValue(protocol);
    const openProtocol = vi.fn().mockResolvedValue(undefined);
    const linkProtocol = vi.fn().mockResolvedValue(undefined);
    const info = vi.fn();

    const uc = new ProtocolFromMeetingUseCase({
      getActiveFile: () => file,
      readFileText: async () => meetingMd({ eventId: "uid" }),
      meetingNotes: { linkProtocol } as any,
      protocols: { createProtocolFromMeetingFile, openProtocol } as any,
      notice,
      log: { info, warn: vi.fn() },
    });

    await uc.createFromActiveMeeting();
    expect(createProtocolFromMeetingFile).toHaveBeenCalledWith(file);
    expect(openProtocol).toHaveBeenCalledWith(protocol);
    expect(linkProtocol).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("если event_id пуст — не линкует, но создаёт и открывает", async () => {
    const notice = vi.fn();
    const file = tfile("m.md");
    const protocol = tfile("p.md");

    const createProtocolFromMeetingFile = vi.fn().mockResolvedValue(protocol);
    const openProtocol = vi.fn().mockResolvedValue(undefined);
    const linkProtocol = vi.fn().mockResolvedValue(undefined);

    const uc = new ProtocolFromMeetingUseCase({
      getActiveFile: () => file,
      readFileText: async () => meetingMd({ eventId: "" }),
      meetingNotes: { linkProtocol } as any,
      protocols: { createProtocolFromMeetingFile, openProtocol } as any,
      notice,
      log: { info: vi.fn(), warn: vi.fn() },
    });

    await uc.createFromActiveMeeting();
    expect(createProtocolFromMeetingFile).toHaveBeenCalledWith(file);
    expect(openProtocol).toHaveBeenCalledWith(protocol);
    expect(linkProtocol).not.toHaveBeenCalled();
  });

  it("если createProtocolFromMeetingFile бросает — логирует warn и показывает notice", async () => {
    const notice = vi.fn();
    const warn = vi.fn();
    const file = tfile("m.md");

    const uc = new ProtocolFromMeetingUseCase({
      getActiveFile: () => file,
      readFileText: async () => meetingMd({}),
      meetingNotes: { linkProtocol: vi.fn() } as any,
      protocols: { createProtocolFromMeetingFile: vi.fn().mockRejectedValue(new Error("boom")), openProtocol: vi.fn() } as any,
      notice,
      log: { info: vi.fn(), warn },
    });

    await uc.createFromActiveMeeting();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalled();
  });
});
