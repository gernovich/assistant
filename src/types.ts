/** Тип источника календаря. */
export type CalendarSourceType = "ics_url" | "caldav";

/** Стабильный идентификатор календаря в настройках. */
export type CalendarId = string;

/** Настройка одного подключённого календаря (ICS URL или CalDAV). */
export interface CalendarConfig {
  /** ID календаря (используется в ссылках/хранилище). */
  id: CalendarId;
  /** Имя календаря в UI. */
  name: string;
  /** Тип источника. */
  type: CalendarSourceType;
  /** Включён ли календарь в refresh/sync. */
  enabled: boolean;
  /** URL ICS, если `type = "ics_url"`. */
  url?: string;
  /** Настройки CalDAV, если `type = "caldav"`. */
  caldav?: {
    /** ID CalDAV аккаунта. */
    accountId: string;
    /** URL календаря (из discovery). */
    calendarUrl: string;
  };
  /** Цвет календаря (CSS-цвет). */
  color?: string;
}

/** Настройка CalDAV аккаунта (Basic или Google OAuth). */
export interface CaldavAccountConfig {
  /** ID аккаунта. */
  id: string;
  /** Название аккаунта (отображается в настройках). */
  name: string;
  /** Включён ли аккаунт (используется в discovery/login). */
  enabled: boolean;
  /** Базовый URL сервера CalDAV. */
  serverUrl: string;
  /** Логин (обычно email). */
  username: string;
  /** Пароль / app password (используется только для Basic). */
  password: string;
  /** Метод авторизации (по умолчанию basic). */
  authMethod?: "basic" | "google_oauth";
  /** OAuth данные (используются для google_oauth). */
  oauth?: {
    /** OAuth Client ID. */
    clientId: string;
    /** OAuth Client Secret. */
    clientSecret: string;
    /** Refresh token, который мы получаем через loopback OAuth. */
    refreshToken: string;
  };
}

/** Все настройки плагина (persisted через Obsidian `loadData/saveData`). */
export interface AssistantSettings {
  debug: {
    /** Включить debug UI/кнопки. */
    enabled: boolean;
  };
  /** Список подключённых календарей. */
  calendars: CalendarConfig[];
  calendar: {
    /** Включено ли автообновление календарей. */
    autoRefreshEnabled: boolean;
    /** Период автообновления в минутах. По умолчанию 10. */
    autoRefreshMinutes: number;
    /** Мой email для определения статуса приглашения (ATTENDEE;PARTSTAT). */
    myEmail: string;
  };
  caldav: {
    /** CalDAV аккаунты. */
    accounts: CaldavAccountConfig[];
  };
  folders: {
    /** Папка проектов. */
    projects: string;
    /** Папка людей. */
    people: string;
    /** Папка заметок встреч. */
    calendarEvents: string;
    /** Папка протоколов. */
    protocols: string;
    /** Папка “Индекс” (дашборды/списки сущностей). */
    index: string;
  };
  notifications: {
    /** Включены ли уведомления. */
    enabled: boolean;
    /** За сколько минут до начала показывать уведомление. По умолчанию 5. */
    minutesBefore: number;
    /** Показывать уведомление в момент начала. По умолчанию true. */
    atStart: boolean;
    delivery: {
      /** Способ доставки уведомлений. */
      method: "obsidian_notice" | "system_notify_send" | "popup_window";
      system: {
        /** Важность уведомления (для notify-send). */
        urgency: "low" | "normal" | "critical";
        /** Таймаут notify-send в мс. */
        timeoutMs: number;
      };
      popup: {
        /** Таймаут окна yad в мс. */
        timeoutMs: number;
      };
    };
  };
  agenda: {
    /** Максимум событий, отображаемых в повестке. По умолчанию 50. */
    maxEvents: number;
  };
  log: {
    /** Максимум записей в памяти. По умолчанию 2048. */
    maxEntries: number;
    /** Сколько дней хранить лог‑файлы в `.obsidian/plugins/assistant/logs`. По умолчанию 7. */
    retentionDays: number;
  };
}

/** Событие календаря (нормализованное представление для UI/синхронизации). */
export interface CalendarEvent {
  /** ID календаря-источника. */
  calendarId: CalendarId;
  /** UID события (из ICS/CalDAV). */
  uid: string;
  /** Заголовок/тема встречи. */
  summary: string;
  /** Описание (если есть). */
  description?: string;
  /** Локация (если есть). */
  location?: string;
  /** Ссылка (если есть). */
  url?: string;
  /** Время начала. */
  start: Date;
  /** Время окончания (если есть). */
  end?: Date;
  /** Признак “весь день”. */
  allDay?: boolean;
  /** Статус приглашения для `myEmail` (если удалось определить). */
  myPartstat?: "accepted" | "declined" | "tentative" | "needs_action";
}
