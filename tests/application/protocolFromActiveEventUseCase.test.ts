import { describe, expect, it, vi } from "vitest";
import { ProtocolFromActiveEventUseCase } from "../../src/application/protocols/protocolFromActiveEventUseCase";

describe("ProtocolFromActiveEventUseCase", () => {
  it("если нет active file — notice", async () => {
    const notice = vi.fn();
    const uc = new ProtocolFromActiveEventUseCase({
      getActiveFile: () => null,
      getFrontmatterCache: () => undefined,
      createProtocolFromEvent: vi.fn(),
      notice,
    });

    await uc.createFromActiveEvent();
    expect(notice).toHaveBeenCalledWith("Ассистент: нет активного файла");
  });

  it("если active file не meeting — notice", async () => {
    const notice = vi.fn();
    const uc = new ProtocolFromActiveEventUseCase({
      getActiveFile: () => ({ path: "m.md", basename: "m" }),
      getFrontmatterCache: () => ({ assistant_type: "project" }),
      createProtocolFromEvent: vi.fn(),
      notice,
    });

    await uc.createFromActiveEvent();
    expect(notice).toHaveBeenCalledWith("Ассистент: открой файл встречи (assistant_type: calendar_event)");
  });

  it("если не хватает полей — notice", async () => {
    const notice = vi.fn();
    const uc = new ProtocolFromActiveEventUseCase({
      getActiveFile: () => ({ path: "m.md", basename: "m" }),
      getFrontmatterCache: () => ({ assistant_type: "calendar_event", calendar_id: "cal" }),
      createProtocolFromEvent: vi.fn(),
      notice,
    });

    await uc.createFromActiveEvent();
    expect(notice).toHaveBeenCalledWith("Ассистент: во встрече не хватает calendar_id/event_id/start");
  });

  it("happy path — вызывает createProtocolFromEvent", async () => {
    const notice = vi.fn();
    const createProtocolFromEvent = vi.fn().mockResolvedValue(undefined);
    const uc = new ProtocolFromActiveEventUseCase({
      getActiveFile: () => ({ path: "m.md", basename: "m" }),
      getFrontmatterCache: () => ({
        assistant_type: "calendar_event",
        calendar_id: "cal",
        event_id: "uid",
        summary: "Meet",
        start: "2020-01-01T10:00:00.000Z",
        end: "2020-01-01T11:00:00.000Z",
      }),
      createProtocolFromEvent,
      notice,
    });

    await uc.createFromActiveEvent();
    expect(createProtocolFromEvent).toHaveBeenCalledTimes(1);
    expect(notice).not.toHaveBeenCalled();
  });
});
