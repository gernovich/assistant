import { describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import type { Event } from "../../src/types";
import { ProtocolUseCase } from "../../src/application/protocols/protocolUseCase";

function file(path: string): TFile {
  return { path, basename: path.split("/").pop() ?? path } as any;
}

function ev(startIso: string): Event {
  return {
    calendar: { id: "cal", name: "Cal", type: "ics_url", config: { id: "cal", name: "Cal", type: "ics_url", enabled: true, url: "" } },
    id: "uid",
    summary: "Meet",
    start: new Date(startIso),
  } as any;
}

describe("ProtocolUseCase", () => {
  it("getMenuState: empty -> hasCurrent/hasLatest=false", async () => {
    const uc = new ProtocolUseCase({
      meetingNotes: {
        listProtocolInfos: async () => [],
      } as any,
      protocols: {} as any,
      notice: () => undefined,
      log: { info: () => undefined },
    });

    const s = await uc.getMenuState(ev("2020-01-01T10:00:00"));
    expect(s).toEqual({ hasCurrent: false, hasLatest: false, currentIsLatest: false });
  });

  it("getMenuState: считает current по sameLocalDate и currentIsLatest", async () => {
    const e = ev("2020-01-01T10:00:00");
    const latest = { file: file("p/latest.md"), start: new Date("2020-01-02T10:00:00") };
    const current = { file: file("p/current.md"), start: new Date("2020-01-01T08:00:00") };

    const uc = new ProtocolUseCase({
      meetingNotes: {
        listProtocolInfos: async () => [latest, current],
      } as any,
      protocols: {} as any,
      notice: () => undefined,
      log: { info: () => undefined },
    });

    const s = await uc.getMenuState(e);
    expect(s.hasLatest).toBe(true);
    expect(s.hasCurrent).toBe(true);
    expect(s.currentIsLatest).toBe(false);
  });

  it("openCurrent: если нет current — notice", async () => {
    const notice = vi.fn();
    const uc = new ProtocolUseCase({
      meetingNotes: {
        listProtocolInfos: async () => [{ file: file("p/other.md"), start: new Date("2020-01-02T10:00:00") }],
      } as any,
      protocols: { openProtocol: vi.fn() } as any,
      notice,
      log: { info: () => undefined },
    });

    await uc.openCurrent(ev("2020-01-01T10:00:00"));
    expect(notice).toHaveBeenCalledTimes(1);
  });

  it("openLatest: если пусто — notice", async () => {
    const notice = vi.fn();
    const uc = new ProtocolUseCase({
      meetingNotes: {
        listProtocolInfos: async () => [],
      } as any,
      protocols: { openProtocol: vi.fn() } as any,
      notice,
      log: { info: () => undefined },
    });

    await uc.openLatest(ev("2020-01-01T10:00:00"));
    expect(notice).toHaveBeenCalledTimes(1);
  });

  it("createOrOpenFromEvent: если hasCurrent — открывает current и не создаёт новый", async () => {
    const openProtocol = vi.fn();
    const createProtocolFromEvent = vi.fn();
    const ensureEventFile = vi.fn();
    const linkProtocol = vi.fn();

    const e = ev("2020-01-01T10:00:00");
    const infos = [{ file: file("p/current.md"), start: new Date("2020-01-01T01:00:00") }];

    const uc = new ProtocolUseCase({
      meetingNotes: {
        listProtocolInfos: async () => infos,
        ensureEventFile,
        linkProtocol,
      } as any,
      protocols: {
        openProtocol,
        createProtocolFromEvent,
      } as any,
      notice: () => undefined,
      log: { info: () => undefined },
    });

    const f = await uc.createOrOpenFromEvent(e);
    expect(f.path).toBe("p/current.md");
    expect(openProtocol).toHaveBeenCalledTimes(1);
    expect(createProtocolFromEvent).not.toHaveBeenCalled();
    expect(ensureEventFile).not.toHaveBeenCalled();
    expect(linkProtocol).not.toHaveBeenCalled();
  });

  it("createOrOpenFromEvent: если протоколов нет — создаёт, открывает и линкует", async () => {
    const openProtocol = vi.fn();
    const createProtocolFromEvent = vi.fn().mockResolvedValue(file("p/new.md"));
    const ensureEventFile = vi.fn().mockResolvedValue(file("m/event.md"));
    const linkProtocol = vi.fn();
    const info = vi.fn();

    const e = ev("2020-01-01T10:00:00");

    const uc = new ProtocolUseCase({
      meetingNotes: {
        listProtocolInfos: async () => [],
        ensureEventFile,
        linkProtocol,
      } as any,
      protocols: {
        openProtocol,
        createProtocolFromEvent,
      } as any,
      notice: () => undefined,
      log: { info },
    });

    const f = await uc.createOrOpenFromEvent(e);
    expect(f.path).toBe("p/new.md");
    expect(ensureEventFile).toHaveBeenCalledTimes(1);
    expect(createProtocolFromEvent).toHaveBeenCalledTimes(1);
    expect(openProtocol).toHaveBeenCalledTimes(1);
    expect(linkProtocol).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(1);
  });
});

