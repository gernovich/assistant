/** Тип источника календаря. */
export type CalendarSourceType = "ics_url" | "caldav";

/** Стабильный идентификатор календаря в настройках. */
export type CalendarId = string;

/** Статус участия (RSVP / PARTSTAT). */
export type RsvpStatus = "accepted" | "declined" | "tentative" | "needs_action";

/** Напоминание события (проекция VALARM/Reminders). */
export interface EventReminderDto {
  /** Raw TRIGGER value (например `-PT5M`). */
  trigger?: string;
  /** Минут до начала (если удалось извлечь). */
  minutesBefore?: number;
  /** ACTION (DISPLAY/EMAIL), если был. */
  action?: string;
  /** DESCRIPTION внутри VALARM (если был). */
  description?: string;
}

/** Статус напоминания (доменное состояние, не из ICS). */
export type ReminderStatus = "planned" | "sent" | "dismissed" | "failed";

/** Повторяемость события (проекция RRULE/EXDATE/RECURRENCE-ID). */
export interface EventRecurrenceDto {
  rrule?: string;
  /** Сырые EXDATE как строки из ICS (могут быть списком через запятую). */
  exdates?: string[];
  /** RECURRENCE-ID (если это экземпляр переопределения). */
  recurrenceId?: string;
}

/**
 * Calendar — runtime DTO календаря (то, с чем работает UI/сервисы).
 *
 * Важно: настройки подключения/включения — в `CalendarConfig`.
 * Здесь держим “сущность календаря”, которая ссылается на свой config.
 */
export interface Calendar {
  /** ID календаря в настройках (стабильный). */
  id: CalendarId;
  /** Отображаемое имя календаря (может отличаться от config.name, если делаем нормализацию). */
  name: string;
  /** Тип источника. */
  type: CalendarSourceType;
  /** Persisted config (источник истины для enabled/url/caldav). */
  config: CalendarConfig;
  /** Runtime: аккаунт (для caldav), без секретов. */
  account?: CalendarAccount;
}

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
  /** Цвет календаря (в основном для CalDAV discovery; используется как резерв для `Event.color`, если у события нет COLOR). */
  color?: string;
  /** URL ICS, если `type = "ics_url"`. */
  url?: string;
  /** Настройки CalDAV, если `type = "caldav"`. */
  caldav?: {
    /** ID CalDAV аккаунта. */
    accountId: string;
    /** URL календаря (из discovery). */
    calendarUrl: string;
  };
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

/** CalendarAccountConfig — persisted config аккаунта CalDAV (с секретами). */
export type CalendarAccountConfig = CaldavAccountConfig;

/** CalendarAccount — runtime DTO аккаунта (без секретов). */
export interface CalendarAccount {
  id: string;
  name: string;
  enabled: boolean;
  serverUrl: string;
  username: string;
  authMethod?: "basic" | "google_oauth";
  /** Есть ли password (для basic). */
  hasPassword?: boolean;
  /** Есть ли OAuth refreshToken (для google_oauth). */
  hasOauthRefreshToken?: boolean;
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
    /**
     * Persistent cache: максимум событий на календарь, которые мы сохраняем на диск.
     *
     * Зачем: ограничить размер файла кэша и избежать разрастания на больших календарях.
     */
    persistentCacheMaxEventsPerCalendar: number;
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
  };
  notifications: {
    /** Включены ли уведомления. */
    enabled: boolean;
    /** За сколько минут до начала показывать уведомление. По умолчанию 5. */
    minutesBefore: number;
    /** Показывать уведомление в момент начала. По умолчанию true. */
    atStart: boolean;
  };
  recording: {
    /** Длина одного файла записи в минутах (нарезка чанков). */
    chunkMinutes: number;
    /**
     * Механизм записи звука.
     *
     * - `electron_media_devices` (MVP, сейчас): пишем микрофон через `navigator.mediaDevices.getUserMedia` + `MediaRecorder`.
     *   Плюсы: не требует внешних бинарников. Минусы: ограничения Chromium/Electron.
     *
     * - `linux_native`: запись через системные утилиты (например `ffmpeg`, PipeWire/Pulse) без участия Chromium.
     *   Плюсы: больше контроля над источниками и миксом. Минусы: нужны зависимости в системе.
     *
     * Совместимость: старое значение `electron_desktop_capturer` при чтении настроек маппится в `electron_media_devices`.
     */
    audioBackend: "electron_media_devices" | "linux_native";
    /**
     * Пост-обработка аудио для Linux Native (ffmpeg filtergraph).
     *
     * - `none`: без обработки (только микс mic+monitor)
     * - `normalize`: нормализация громкости (EBU-like one-pass) + лимитер
     * - `voice`: лёгкий "голосовой" пресет (EQ+мягкий denoise на микрофоне) + нормализация + лимитер
     *
     * Важно: агрессивный шумодав после микса может ухудшать системный звук, поэтому `voice` обрабатывает только mic-вход.
     */
    linuxNativeAudioProcessing: "none" | "normalize" | "voice";
    /** Автостарт записи, если выбранное событие уже идёт. */
    autoStartEnabled: boolean;
    /** Тайминг автостарта записи (секунды). По умолчанию 5. */
    autoStartSeconds: number;
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
export interface Event {
  /** Календарь-источник (runtime DTO). */
  calendar: Calendar;
  /** ID события (из ICS/CalDAV UID). */
  id: string;
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
  /** Часовой пояс события (TZID или `UTC`, если DTSTART/DTEND в Z). */
  timeZone?: string;
  /** Признак “весь день”. */
  allDay?: boolean;
  /** Статус приглашения (RSVP/PARTSTAT) для `myEmail` (если удалось определить). */
  status?: RsvpStatus;
  /** Повторяемость (если удалось извлечь из ICS). */
  recurrence?: EventRecurrenceDto;
  /** SEQUENCE (для обратной записи CalDAV и контроля конфликтов), если удалось извлечь. */
  sequence?: number;
  /** LAST-MODIFIED (для обратной записи CalDAV и контроля конфликтов), если удалось извлечь. */
  lastModified?: string;
  /** Напоминания (если удалось извлечь из ICS). */
  reminders?: Array<
    EventReminderDto & {
      status: ReminderStatus;
      person: Person;
    }
  >;
  /** Цвет события (будущее поле; может заполняться из ICS `COLOR` или API). */
  color?: EventColor;
  /** Организатор встречи (если удалось извлечь из ICS/CalDAV ORGANIZER). */
  organizer?: Person;
  /** Участники встречи (если удалось извлечь из ICS/CalDAV). */
  attendees?: Array<{
    /** Email участника (lowercase). */
    email: string;
    /** Имя (CN), если было в ICS. */
    cn?: string;
    /** PARTSTAT из ICS (как строка для гибкости). */
    partstat?: string;
    /** ROLE из ICS (как строка для гибкости). */
    role?: string;
  }>;
}

/**
 * Occurrence — конкретный экземпляр (дата) встречи.
 *
 * Сейчас в коде occurrences представлены как `Event`, но Occurrence нужен как явный контракт
 * для сценариев “обновить конкретную дату” (CalDAV override/RECURRENCE-ID).
 */
export interface Occurrence {
  calendar: Calendar;
  /** UID события (общий для series/master). */
  eventId: string;
  /** DTSTART конкретного экземпляра. */
  start: Date;
  /** DTEND конкретного экземпляра (если есть). */
  end?: Date;
  /** RECURRENCE-ID (если это override-экземпляр). */
  recurrenceId?: string;
  /** SEQUENCE (если провайдер даёт). */
  sequence?: number;
  /** LAST-MODIFIED (если провайдер даёт). */
  lastModified?: string;
}

// -----------------------------------------------------------------------------
// DTO (контракты между слоями). Используем как “единый словарь” сущностей проекта.
// -----------------------------------------------------------------------------

/** Устаревшее: старое имя, оставлено для обратной совместимости типов. */
export type CalendarAccountDto = CalendarAccountConfig;

/** DTO frontmatter карточки встречи (md в хранилище). */
export interface MeetingNoteDto {
  assistant_type: "calendar_event";
  calendar_id: CalendarId;
  event_id: string;
  summary: string;
  start: string; // ISO
  end?: string; // ISO
  url?: string;
  location?: string;
  organizer_email?: string;
  organizer_cn?: string;
  status?: RsvpStatus;
  /** Все участники (person_id). */
  attendees?: string[];
  /** Участники по статусам (person_id). */
  attendees_accepted?: string[];
  attendees_declined?: string[];
  attendees_tentative?: string[];
  attendees_needs_action?: string[];
  attendees_unknown?: string[];
}

// -----------------------------------------------------------------------------
// Domain DTO: сущности, с которыми работает код (runtime/интерфейс/юзкейсы).
// Frontmatter DTO: как эти сущности выглядят в хранилище (YAML, snake_case).
// -----------------------------------------------------------------------------

export type PersonId = string;
export type ProjectId = string;
export type ProtocolId = string;

export type AssistantEntityType = "calendar_event" | "protocol" | "person" | "project";

/** Ссылка на человека (для вложенных объектов/связей). */
export interface PersonLinkDto {
  person_id?: PersonId;
  display_name?: string;
  email?: string;
}

/** Ссылка на проект (для вложенных объектов/связей). */
export interface ProjectLinkDto {
  project_id?: ProjectId;
  title?: string;
}

/** DTO человека (runtime, без `assistant_type`). */
export interface Person {
  /** ID человека (если карточка уже создана). */
  id?: PersonId;
  /** Полное имя (как хотим видеть в таблицах/ссылках). */
  displayName?: string;
  /** Имя. */
  firstName?: string;
  /** Фамилия. */
  lastName?: string;
  /** Отчество. */
  middleName?: string;
  /** Кличка/ник. */
  nickName?: string;
  /** Пол (свободная строка/код). */
  gender?: string;
  /** Фото (путь/URL). */
  photo?: string;
  /** День рождения (например `YYYY-MM-DD`). */
  birthday?: string;
  /** Голосовой отпечаток (например путь к файлу / идентификатор / ссылка). */
  voiceprint?: string;
  /** Email-адреса человека. */
  emails?: string[];
  /** Компании (может быть несколько). */
  companies?: string[];
  /** Должности (может быть несколько). */
  positions?: string[];
  /** Телефоны. */
  phones?: Array<{
    label?: string; // mobile/work/home/...
    value: string;
  }>;
  /** Почтовые ящики (legacy; оставлено для обратной совместимости). */
  mailboxes?: string[];
  /** Мессенджеры. */
  messengers?: Array<{
    kind: string; // telegram/whatsapp/signal/slack/...
    handle: string;
    url?: string;
  }>;
}

/** DTO frontmatter карточки человека (md в vault). */
export interface PersonNoteDto {
  assistant_type: "person";
  person_id: PersonId;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  nick_name?: string;
  gender?: string;
  photo?: string;
  birthday?: string;
  voiceprint?: string;
  /** Email-адреса (основной массив). */
  emails?: string[];
  /** Телефоны. */
  phones?: Array<{ label?: string; value: string }>;
  /** Компании. */
  companies?: string[];
  /** Должности. */
  positions?: string[];
  /** Почтовые ящики. */
  mailboxes?: string[];
  messengers?: Array<{ kind: string; handle: string; url?: string }>;
}

export type ProjectRef = Pick<Project, "id" | "title">;

/** DTO протокола (runtime). */
export interface Protocol {
  id: ProtocolId;
  calendar: Calendar;
  start: string; // ISO
  end?: string; // ISO
  /** Краткое содержание. */
  summary?: string;
  /** Расшифровка (транскрибация) текстом. */
  transcript?: string;
  /** Список файлов (пути/URL). */
  files?: string[];
  /** Участники протокола. */
  participants?: Person[];
  /** Проекты, к которым относится протокол. */
  projects?: ProjectRef[];
}

/** ProtocolNote — persisted frontmatter протокола (md в vault). */
export interface ProtocolNote {
  assistant_type: "protocol";
  protocol_id: string;
  calendar_id: CalendarId;
  start: string; // ISO
  end?: string; // ISO
  summary?: string;
  transcript?: string;
  files?: string[];
  participants?: PersonLinkDto[];
  projects?: ProjectLinkDto[];
}

export type ProtocolRef = Pick<Protocol, "id" | "start" | "end" | "summary">;

/** DTO проекта (runtime). */
export interface Project {
  id: ProjectId;
  title: string;
  status?: string;
  owner?: Person;
  tags?: string[];
  /** Протоколы проекта (ссылки/мини-DTО). */
  protocols?: ProtocolRef[];
}

/** DTO frontmatter карточки проекта (md в vault). */
export interface ProjectNoteDto {
  assistant_type: "project";
  project_id: ProjectId;
  title: string;
  status?: string;
  owner?: PersonLinkDto;
  tags?: string[];
  protocols?: Array<Pick<ProtocolNote, "protocol_id" | "start" | "end" | "summary">>;
}

/** DTO цвета события. Сейчас основное заполнение: ICS `COLOR` → `value`. */
export interface EventColor {
  /** Provider-specific ID (например Google Calendar `colorId`). */
  id?: string;
  /** Человекочитаемое имя (“Мои/Важные/Плановые”). */
  name?: string;
  /** Отображаемый цвет (например hex). */
  value?: string;
}
