import type { AssistantSettings, CalendarConfig, CaldavAccountConfig } from "./types";

/** Настройки по умолчанию для плагина. */
export const DEFAULT_SETTINGS: AssistantSettings = {
  debug: {
    enabled: false,
  },
  calendars: [],
  calendar: {
    autoRefreshEnabled: true,
    autoRefreshMinutes: 10,
    myEmail: "",
    persistentCacheMaxEventsPerCalendar: 2000,
  },
  caldav: {
    accounts: [],
  },
  folders: {
    projects: "Ассистент/Проекты",
    people: "Ассистент/Люди",
    calendarEvents: "Ассистент/Встречи",
    protocols: "Ассистент/Протоколы",
  },
  notifications: {
    enabled: true,
    minutesBefore: 5,
    atStart: true,
  },
  recording: {
    chunkMinutes: 5,
    audioBackend: "electron_desktop_capturer",
    linuxNativeAudioProcessing: "normalize",
    autoStartEnabled: false,
    autoStartSeconds: 5,
  },
  agenda: {
    maxEvents: 50,
  },
  log: {
    maxEntries: 2048,
    retentionDays: 7,
  },
};

/**
 * Нормализовать настройки, загруженные из Obsidian `loadData()`.
 *
 * Делает:
 * - заполнение значений по умолчанию
 *
 * Важно: до первого релиза **не поддерживаем миграции** — формат настроек считается “с нуля”.
 */
export function normalizeSettings(raw: unknown): AssistantSettings {
  const obj = (raw ?? {}) as Partial<AssistantSettings>;
  const calendars = Array.isArray(obj.calendars) ? obj.calendars : [];
  const caldavAccounts = Array.isArray(obj.caldav?.accounts) ? obj.caldav?.accounts : [];
  return {
    debug: {
      enabled: obj.debug?.enabled ?? DEFAULT_SETTINGS.debug.enabled,
    },
    calendars: calendars.map((c) => normalizeCalendar(c as Partial<CalendarConfig>)).filter((c): c is CalendarConfig => Boolean(c)),
    calendar: {
      autoRefreshEnabled: obj.calendar?.autoRefreshEnabled ?? DEFAULT_SETTINGS.calendar.autoRefreshEnabled,
      autoRefreshMinutes: obj.calendar?.autoRefreshMinutes ?? DEFAULT_SETTINGS.calendar.autoRefreshMinutes,
      myEmail: (obj.calendar?.myEmail ?? DEFAULT_SETTINGS.calendar.myEmail).trim(),
      persistentCacheMaxEventsPerCalendar: normalizePersistentCacheMaxEventsPerCalendar(
        obj.calendar?.persistentCacheMaxEventsPerCalendar ?? DEFAULT_SETTINGS.calendar.persistentCacheMaxEventsPerCalendar,
      ),
    },
    caldav: {
      accounts: caldavAccounts
        .map((a) => normalizeCaldavAccount(a as Partial<CaldavAccountConfig>))
        .filter((a): a is CaldavAccountConfig => Boolean(a)),
    },
    folders: {
      projects: obj.folders?.projects ?? DEFAULT_SETTINGS.folders.projects,
      people: obj.folders?.people ?? DEFAULT_SETTINGS.folders.people,
      calendarEvents: obj.folders?.calendarEvents ?? DEFAULT_SETTINGS.folders.calendarEvents,
      protocols: obj.folders?.protocols ?? DEFAULT_SETTINGS.folders.protocols,
    },
    notifications: {
      enabled: obj.notifications?.enabled ?? DEFAULT_SETTINGS.notifications.enabled,
      minutesBefore: obj.notifications?.minutesBefore ?? DEFAULT_SETTINGS.notifications.minutesBefore,
      atStart: obj.notifications?.atStart ?? DEFAULT_SETTINGS.notifications.atStart,
    },
    recording: {
      chunkMinutes: typeof obj.recording?.chunkMinutes === "number" ? obj.recording.chunkMinutes : DEFAULT_SETTINGS.recording.chunkMinutes,
      audioBackend:
        obj.recording?.audioBackend === "linux_native" || obj.recording?.audioBackend === "electron_desktop_capturer"
          ? obj.recording.audioBackend
          : DEFAULT_SETTINGS.recording.audioBackend,
      linuxNativeAudioProcessing:
        obj.recording?.linuxNativeAudioProcessing === "none" ||
        obj.recording?.linuxNativeAudioProcessing === "normalize" ||
        obj.recording?.linuxNativeAudioProcessing === "voice"
          ? obj.recording.linuxNativeAudioProcessing
          : DEFAULT_SETTINGS.recording.linuxNativeAudioProcessing,
      autoStartEnabled:
        typeof obj.recording?.autoStartEnabled === "boolean" ? obj.recording.autoStartEnabled : DEFAULT_SETTINGS.recording.autoStartEnabled,
      autoStartSeconds:
        typeof obj.recording?.autoStartSeconds === "number" ? obj.recording.autoStartSeconds : DEFAULT_SETTINGS.recording.autoStartSeconds,
    },
    agenda: {
      maxEvents: obj.agenda?.maxEvents ?? DEFAULT_SETTINGS.agenda.maxEvents,
    },
    log: {
      maxEntries: obj.log?.maxEntries ?? DEFAULT_SETTINGS.log.maxEntries,
      retentionDays: normalizeRetentionDays(obj.log?.retentionDays ?? DEFAULT_SETTINGS.log.retentionDays),
    },
  };
}

function normalizeRetentionDays(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 7;
  // Ограничиваем в разумных пределах, чтобы не выстрелить себе в ногу.
  return Math.min(365, Math.max(1, Math.floor(n)));
}

function normalizePersistentCacheMaxEventsPerCalendar(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 2000;
  // Ограничиваем, чтобы файл кэша не разрастался до гигантских размеров.
  return Math.min(20_000, Math.max(1, Math.floor(n)));
}

function normalizeCalendar(c: Partial<CalendarConfig>): CalendarConfig | null {
  if (!c || typeof c !== "object") return null;
  if (!c.id || typeof c.id !== "string") return null;
  if (!c.name || typeof c.name !== "string") return null;

  if (c.type === "ics_url") {
    return {
      id: c.id,
      name: c.name,
      type: "ics_url",
      enabled: c.enabled ?? true,
      url: typeof c.url === "string" ? c.url : "",
    };
  }

  if (c.type === "caldav") {
    // Keep the record even if account/calendar url is not configured yet (user can edit later).
    const caldav = (c.caldav ?? {}) as Partial<NonNullable<CalendarConfig["caldav"]>>;
    return {
      id: c.id,
      name: c.name,
      type: "caldav",
      enabled: c.enabled ?? true,
      caldav: {
        accountId: typeof caldav.accountId === "string" ? caldav.accountId : "",
        calendarUrl: typeof caldav.calendarUrl === "string" ? caldav.calendarUrl : "",
      },
    };
  }

  return null;
}

function normalizeCaldavAccount(a: Partial<CaldavAccountConfig>): CaldavAccountConfig | null {
  if (!a || typeof a !== "object") return null;
  if (!a.id || typeof a.id !== "string") return null;
  if (!a.name || typeof a.name !== "string") return null;

  const authMethod = a.authMethod === "google_oauth" || a.authMethod === "basic" ? a.authMethod : "basic";
  const oauthAny = (a.oauth ?? {}) as Partial<NonNullable<CaldavAccountConfig["oauth"]>>;

  return {
    id: a.id,
    name: a.name,
    enabled: a.enabled ?? true,
    serverUrl: typeof a.serverUrl === "string" ? a.serverUrl : "",
    username: typeof a.username === "string" ? a.username : "",
    password: typeof a.password === "string" ? a.password : "",
    authMethod,
    oauth:
      authMethod === "google_oauth"
        ? {
            clientId: typeof oauthAny.clientId === "string" ? oauthAny.clientId : "",
            clientSecret: typeof oauthAny.clientSecret === "string" ? oauthAny.clientSecret : "",
            refreshToken: typeof oauthAny.refreshToken === "string" ? oauthAny.refreshToken : "",
          }
        : undefined,
  };
}
