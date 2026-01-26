import { describe, expect, it, vi } from "vitest";
import { PeopleFromMeetingUseCase } from "../../src/application/people/peopleFromMeetingUseCase";

describe("PeopleFromMeetingUseCase", () => {
  it("если нет active file — notice", async () => {
    const notice = vi.fn();
    const uc = new PeopleFromMeetingUseCase({
      getActiveFile: () => null,
      getFrontmatterCache: () => undefined,
      readFileText: async () => "",
      people: { ensureByEmail: vi.fn() } as any,
      notice,
      log: { warn: vi.fn() },
    });

    await uc.createPeopleCardsFromActiveMeeting();
    expect(notice).toHaveBeenCalledWith("Ассистент: откройте заметку встречи");
  });

  it("если активный файл не meeting — notice", async () => {
    const notice = vi.fn();
    const uc = new PeopleFromMeetingUseCase({
      getActiveFile: () => ({ path: "x.md" }),
      getFrontmatterCache: () => ({ assistant_type: "project" }),
      readFileText: async () => "",
      people: { ensureByEmail: vi.fn() } as any,
      notice,
      log: { warn: vi.fn() },
    });

    await uc.createPeopleCardsFromActiveMeeting();
    expect(notice).toHaveBeenCalledWith("Ассистент: активный файл — не заметка встречи");
  });

  it("если emails не найдены — notice", async () => {
    const notice = vi.fn();
    const uc = new PeopleFromMeetingUseCase({
      getActiveFile: () => ({ path: "m.md" }),
      getFrontmatterCache: () => ({ assistant_type: "calendar_event" }),
      readFileText: async () => "no emails here",
      people: { ensureByEmail: vi.fn() } as any,
      notice,
      log: { warn: vi.fn() },
    });

    await uc.createPeopleCardsFromActiveMeeting();
    expect(notice).toHaveBeenCalledWith("Ассистент: не удалось извлечь email участников из тела заметки встречи");
  });

  it("happy path — вызывает ensureByEmail для каждого email и показывает итог", async () => {
    const notice = vi.fn();
    const ensureByEmail = vi.fn().mockResolvedValue(undefined);
    const uc = new PeopleFromMeetingUseCase({
      getActiveFile: () => ({ path: "m.md" }),
      getFrontmatterCache: () => ({ assistant_type: "calendar_event" }),
      readFileText: async () => "a@ex.com b@ex.com a@ex.com",
      people: { ensureByEmail } as any,
      notice,
      log: { warn: vi.fn() },
    });

    await uc.createPeopleCardsFromActiveMeeting();
    expect(ensureByEmail).toHaveBeenCalledTimes(2);
    expect(notice).toHaveBeenCalledWith("Ассистент: карточки людей обработаны: 2");
  });
});
