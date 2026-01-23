import { describe, expect, it, vi } from "vitest";
import { OutboxApplyUseCase } from "../../src/application/offline/outboxApplyUseCase";
import type { OutboxItemV1 } from "../../src/offline/outboxService";

describe("OutboxApplyUseCase", () => {
  it("если очередь пуста — показывает notice и ничего не меняет", async () => {
    const notice = vi.fn();
    const replace = vi.fn();

    const uc = new OutboxApplyUseCase({
      list: async () => [],
      replace,
      setMyPartstatInCalendar: async () => undefined,
      notice,
      log: { warn: vi.fn() },
    });

    const r = await uc.applyAll();
    expect(r).toEqual({ applied: 0, remaining: 0 });
    expect(notice).toHaveBeenCalledWith("Ассистент: очередь пуста");
    expect(replace).not.toHaveBeenCalled();
  });

  it("валидный set_event_partstat — применяет и удаляет из очереди", async () => {
    const notice = vi.fn();
    const replace = vi.fn();
    const setMyPartstatInCalendar = vi.fn().mockResolvedValue(undefined);

    const items: OutboxItemV1[] = [
      {
        version: 1,
        id: "1",
        createdAtMs: 1,
        kind: "set_event_partstat",
        payload: { calendarId: "cal", uid: "uid", start: "2020-01-01T10:00:00Z", partstat: "accepted" },
      },
    ];

    const uc = new OutboxApplyUseCase({
      list: async () => items,
      replace,
      setMyPartstatInCalendar,
      notice,
      log: { warn: vi.fn() },
    });

    const r = await uc.applyAll();
    expect(r).toEqual({ applied: 1, remaining: 0 });
    expect(setMyPartstatInCalendar).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith([]);
    expect(notice).toHaveBeenCalledWith("Ассистент: применено действий: 1, осталось: 0");
  });

  it("невалидный payload — оставляет элемент в очереди", async () => {
    const notice = vi.fn();
    const replace = vi.fn();
    const setMyPartstatInCalendar = vi.fn().mockResolvedValue(undefined);

    const items: OutboxItemV1[] = [
      {
        version: 1,
        id: "1",
        createdAtMs: 1,
        kind: "set_event_partstat",
        payload: { calendarId: "cal", uid: "uid", start: "bad-date", partstat: "accepted" },
      },
    ];

    const uc = new OutboxApplyUseCase({
      list: async () => items,
      replace,
      setMyPartstatInCalendar,
      notice,
      log: { warn: vi.fn() },
    });

    const r = await uc.applyAll();
    expect(r).toEqual({ applied: 0, remaining: 1 });
    expect(setMyPartstatInCalendar).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith(items);
  });
});
