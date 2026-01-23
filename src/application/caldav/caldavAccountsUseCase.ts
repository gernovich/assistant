import type { LogService } from "../../log/logService";
import type { CaldavAccountPatch } from "../settings/settingsCommands";

export class CaldavAccountsUseCase {
  constructor(
    private readonly deps: {
      applyAccountUpdate: (accountId: string, patch: CaldavAccountPatch) => Promise<void>;
      addAccount: () => Promise<void>;
      removeAccount: (accountId: string) => Promise<void>;
      authorizeGoogle: (accountId: string) => Promise<void>;
      discoverCalendars: (accountId: string) => Promise<Array<{ displayName: string; url: string; color?: string }>>;
      addCaldavCalendarFromDiscovery: (params: { name: string; accountId: string; calendarUrl: string; color?: string }) => Promise<void>;
      notice: (msg: string) => void;
      log: LogService;
    },
  ) {}

  async addAccount(): Promise<void> {
    await this.deps.addAccount();
  }

  async updateAccount(accountId: string, patch: CaldavAccountPatch): Promise<void> {
    await this.deps.applyAccountUpdate(accountId, patch);
  }

  async removeAccount(accountId: string): Promise<void> {
    await this.deps.removeAccount(accountId);
  }

  async authorizeGoogleCaldav(accountId: string): Promise<void> {
    await this.deps.authorizeGoogle(accountId);
  }

  async discover(accountId: string): Promise<Array<{ displayName: string; url: string; color?: string }>> {
    return await this.deps.discoverCalendars(accountId);
  }

  async addCalendarFromDiscovery(params: { name: string; accountId: string; calendarUrl: string; color?: string }): Promise<void> {
    if (!params.calendarUrl) {
      this.deps.notice("Ассистент: календарь без URL нельзя добавить");
      return;
    }
    await this.deps.addCaldavCalendarFromDiscovery(params);
  }
}

