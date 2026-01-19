import { Notice } from "obsidian";
import type { AssistantSettings, CalendarEvent } from "../types";
import { linuxNotifySend } from "../os/linuxNotify";
import { linuxPopupWindow } from "../os/linuxPopup";
import { MS_PER_HOUR, NOTIFICATIONS_HORIZON_HOURS } from "../calendar/constants";

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
  private linuxNotifyFailedOnce = false;

  /**
   * @param onLog Логгер для диагностики (используется в LogService).
   * @param actions Коллбеки на действия из popup окна (создать протокол, и т.п.).
   */
  constructor(
    settings: AssistantSettings,
    onLog?: (message: string) => void,
    private actions?: {
      createProtocol?: (ev: CalendarEvent) => void | Promise<void>;
      startRecording?: (ev: CalendarEvent) => void | Promise<void>;
      meetingCancelled?: (ev: CalendarEvent) => void | Promise<void>;
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
  schedule(events: CalendarEvent[]) {
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
            void this.showGlobal(ev, msg);
          }, beforeMs - now),
        );
      }

      if (this.settings.notifications.atStart && startMs > now) {
        this.timers.push(
          window.setTimeout(() => {
            const msg = `Началась: ${formatEvent(ev)}`;
            void this.showGlobal(ev, msg);
          }, startMs - now),
        );
      }
    }
  }

  debugShowReminder(ev: CalendarEvent) {
    const minutesBefore = Math.max(0, this.settings.notifications.minutesBefore);
    const msg = `Через ${minutesBefore} мин: ${formatEvent(ev)}`;
    void this.showGlobal(ev, msg, true);
  }

  private async showGlobal(ev: CalendarEvent, msg: string, isDebug = false) {
    const prefix = isDebug ? "DEBUG уведомление" : "Показано уведомление";
    this.onLog?.(`${prefix}: ${msg}`);
    // Обратная совместимость: старые настройки (например из тестов) могли не иметь delivery.*.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyNotifications = this.settings.notifications as any;
    const method =
      this.settings.notifications.delivery?.method ??
      (anyNotifications?.global?.enabled === true ? "system_notify_send" : "obsidian_notice");

    if (method === "obsidian_notice") {
      new Notice(msg);
      return;
    }

    if (method === "system_notify_send") {
      try {
        await linuxNotifySend("Ассистент", msg, this.settings);
      } catch (e) {
        if (!this.linuxNotifyFailedOnce) {
          this.linuxNotifyFailedOnce = true;
          this.onLog?.("notify-send: ошибка (поставьте пакет libnotify-bin), уведомление не показано");
        }
        void e;
      }
      return;
    }

    // popup_window (yad)
    try {
      const action = await linuxPopupWindow(ev, msg, this.settings);
      if (action === "start_recording") {
        this.onLog?.("Popup: нажато «Начать запись» (MVP — без записи)");
        await this.actions?.startRecording?.(ev);
      }
      if (action === "create_protocol") {
        this.onLog?.("Popup: нажато «Создать протокол»");
        await this.actions?.createProtocol?.(ev);
      }
      if (action === "cancelled") {
        this.onLog?.("Popup: нажато «Встреча отменена»");
        await this.actions?.meetingCancelled?.(ev);
      }
    } catch (e) {
      this.onLog?.("popup_window: ошибка (требуется пакет yad), уведомление не показано");
      void e;
    }
  }
}

function formatEvent(ev: CalendarEvent): string {
  const t = ev.allDay ? "весь день" : ev.start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${t} — ${ev.summary}`;
}
