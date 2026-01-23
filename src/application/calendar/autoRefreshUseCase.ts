import type { AssistantSettings } from "../../types";

type Logger = {
  info: (message: string, data?: Record<string, unknown>) => void;
};

// В TS-проектах с DOM+Node типами `setInterval` может возвращать `number` или `Timeout`.
type IntervalId = number | ReturnType<typeof globalThis.setInterval>;

export type AutoRefreshUseCaseDeps = {
  getSettings: () => AssistantSettings;
  refreshCalendars: () => Promise<void>;
  setInterval: (fn: () => void, ms: number) => IntervalId;
  clearInterval: (id: IntervalId) => void;
  log: Logger;
};

export class AutoRefreshUseCase {
  private timerId?: IntervalId;

  constructor(private readonly deps: AutoRefreshUseCaseDeps) {}

  stop(): void {
    if (this.timerId) this.deps.clearInterval(this.timerId);
    this.timerId = undefined;
  }

  setup(): void {
    this.stop();

    const s = this.deps.getSettings();
    if (!s.calendar.autoRefreshEnabled) {
      this.deps.log.info("Автообновление: выключено");
      return;
    }

    const minutes = Math.max(1, s.calendar.autoRefreshMinutes);
    const intervalMs = minutes * 60_000;
    this.deps.log.info("Автообновление: включено", { minutes });

    this.timerId = this.deps.setInterval(() => {
      void this.deps.refreshCalendars();
    }, intervalMs);
  }
}
