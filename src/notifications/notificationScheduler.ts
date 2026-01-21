import { Notice } from "obsidian";
import type { AssistantSettings, Event } from "../types";
import { MS_PER_HOUR, NOTIFICATIONS_HORIZON_HOURS } from "../calendar/constants";
import { showElectronReminderWindow } from "./electronWindowReminder";

/**
 * Планировщик уведомлений по событиям календаря.
 *
 * Делает MVP-расписание через `setTimeout` и поддерживает несколько способов доставки:
 * - Obsidian Notice
 * - `notify-send` (Linux)
 * - popup окно через `yad` (Linux)
 */
export class NotificationScheduler {
  private settings: AssistantSettings;
  private timers: number[] = [];
  private onLog?: (message: string) => void;

  /**
   * @param onLog Логгер для диагностики (используется в LogService).
   * @param actions Коллбеки на действия из popup окна (создать протокол, и т.п.).
   */
  constructor(
    settings: AssistantSettings,
    onLog?: (message: string) => void,
    private actions?: {
      createProtocol?: (ev: Event) => unknown | Promise<unknown>;
      startRecording?: (ev: Event) => void | Promise<void>;
      meetingCancelled?: (ev: Event) => void | Promise<void>;
    },
  ) {
    this.settings = settings;
    this.onLog = onLog;
  }

  /** Обновить настройки без пересоздания планировщика. */
  setSettings(settings: AssistantSettings) {
    this.settings = settings;
  }

  /** Снять все активные таймеры уведомлений. */
  clear() {
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
  }

  /** Пересобрать расписание уведомлений по списку событий. */
  schedule(events: Event[]) {
    this.clear();
    if (!this.settings.notifications.enabled) return;

    const now = Date.now();
    const minutesBefore = Math.max(0, this.settings.notifications.minutesBefore);

    // MVP: планируем только ближайшие события (в горизонте), чтобы не плодить сотни таймеров.
    const horizonMs = NOTIFICATIONS_HORIZON_HOURS * MS_PER_HOUR;
    const until = now + horizonMs;

    for (const ev of events) {
      const startMs = ev.start.getTime();
      if (startMs < now - 60_000) continue;
      if (startMs > until) continue;

      const beforeMs = startMs - minutesBefore * 60_000;
      if (beforeMs > now) {
        this.timers.push(
          window.setTimeout(() => {
            const msg = `Через ${minutesBefore} мин: ${formatEvent(ev)}`;
            void this.showGlobal(ev, msg, "before");
          }, beforeMs - now),
        );
      }

      if (this.settings.notifications.atStart && startMs > now) {
        this.timers.push(
          window.setTimeout(() => {
            const msg = `Началась: ${formatEvent(ev)}`;
            void this.showGlobal(ev, msg, "start");
          }, startMs - now),
        );
      }
    }
  }

  debugShowReminder(ev: Event) {
    const minutesBefore = Math.max(0, this.settings.notifications.minutesBefore);
    const msg = `Через ${minutesBefore} мин: ${formatEvent(ev)}`;
    void this.showGlobal(ev, msg, "before", true);
  }

  private async showGlobal(ev: Event, msg: string, kind: "before" | "start", isDebug = false) {
    const prefix = isDebug ? "DEBUG уведомление" : "Показано уведомление";
    this.onLog?.(`${prefix}: ${msg}`);
    try {
      // Единый способ: отдельное окно поверх всех (Electron).
      showElectronReminderWindow({ ev, kind, minutesBefore: Math.max(0, this.settings.notifications.minutesBefore), actions: this.actions });
    } catch (e) {
      // Safety: если BrowserWindow недоступен (тесты/необычное окружение) — хотя бы Notice внутри Obsidian.
      this.onLog?.(`electron_window: ошибка (${String((e as unknown) ?? "неизвестно")}), fallback на Notice`);
      new Notice(msg);
    }
  }
}

function formatEvent(ev: Event): string {
  const t = ev.allDay ? "весь день" : ev.start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${t} — ${ev.summary}`;
}
