import { describe, expect, it, vi } from "vitest";
import { LogService } from "../../src/log/logService";
import { CaldavAccountsUseCase } from "../../src/application/caldav/caldavAccountsUseCase";

describe("CaldavAccountsUseCase", () => {
  it("addCalendarFromDiscovery: не вызывает add если calendarUrl пустой", async () => {
    const notice = vi.fn();
    const add = vi.fn(async () => {});

    const uc = new CaldavAccountsUseCase({
      applyAccountUpdate: async () => {},
      addAccount: async () => {},
      removeAccount: async () => {},
      authorizeGoogle: async () => {},
      discoverCalendars: async () => [],
      addCaldavCalendarFromDiscovery: add,
      notice,
      log: new LogService(200),
    });

    await uc.addCalendarFromDiscovery({ name: "N", accountId: "acc1", calendarUrl: "" });
    expect(add).toHaveBeenCalledTimes(0);
    expect(notice).toHaveBeenCalled();
  });
});
