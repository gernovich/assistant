import type { AssistantSettings, CalendarConfig, CaldavAccountConfig } from "./types";

export const DEFAULT_SETTINGS: AssistantSettings = {
  debug: {
    enabled: false,
  },
  calendars: [],
  calendar: {
    autoRefreshEnabled: true,
    autoRefreshMinutes: 10,
    myEmail: "",
  },
  caldav: {
    accounts: [],
  },
  folders: {
    logs: "Ассистент/Логи",
    projects: "Ассистент/Проекты",
    people: "Ассистент/Люди",
    calendarEvents: "Ассистент/Встречи",
    protocols: "Ассистент/Протоколы",
  },
  notifications: {
    enabled: true,
    minutesBefore: 5,
    atStart: true,
    delivery: {
      method: "system_notify_send",
      system: {
        urgency: "critical",
        timeoutMs: 20_000,
      },
      popup: {
        timeoutMs: 20_000,
      },
    },
  },
  agenda: {
    maxEvents: 50,
  },
  log: {
    maxEntries: 200,
    writeToVault: true,
  },
};

export function normalizeSettings(raw: unknown): AssistantSettings {
  const obj = (raw ?? {}) as Partial<AssistantSettings>;
  const calendars = Array.isArray(obj.calendars) ? obj.calendars : [];
  const caldavAccounts = Array.isArray(obj.caldav?.accounts) ? obj.caldav?.accounts : [];

  // Migration: old versions stored notify-send config in notifications.global.*
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyNotifications = (obj.notifications ?? {}) as any;
  const oldGlobal = anyNotifications?.global;
  const delivery = anyNotifications?.delivery ?? {};

  const migratedMethod =
    delivery?.method ??
    (oldGlobal?.enabled === true ? "system_notify_send" : undefined) ??
    DEFAULT_SETTINGS.notifications.delivery.method;

  return {
    debug: {
      enabled: obj.debug?.enabled ?? DEFAULT_SETTINGS.debug.enabled,
    },
    calendars: calendars
      .map((c) => normalizeCalendar(c as Partial<CalendarConfig>))
      .filter((c): c is CalendarConfig => Boolean(c)),
    calendar: {
      autoRefreshEnabled:
        obj.calendar?.autoRefreshEnabled ?? DEFAULT_SETTINGS.calendar.autoRefreshEnabled,
      autoRefreshMinutes:
        obj.calendar?.autoRefreshMinutes ?? DEFAULT_SETTINGS.calendar.autoRefreshMinutes,
      myEmail: (obj.calendar?.myEmail ?? DEFAULT_SETTINGS.calendar.myEmail).trim(),
    },
    caldav: {
      accounts: caldavAccounts
        .map((a) => normalizeCaldavAccount(a as Partial<CaldavAccountConfig>))
        .filter((a): a is CaldavAccountConfig => Boolean(a)),
    },
    folders: {
      // Migration: older versions stored logs path in log.folderPath
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logs: obj.folders?.logs ?? (obj as any)?.log?.folderPath ?? DEFAULT_SETTINGS.folders.logs,
      projects: obj.folders?.projects ?? DEFAULT_SETTINGS.folders.projects,
      people: obj.folders?.people ?? DEFAULT_SETTINGS.folders.people,
      calendarEvents: obj.folders?.calendarEvents ?? DEFAULT_SETTINGS.folders.calendarEvents,
      protocols: obj.folders?.protocols ?? DEFAULT_SETTINGS.folders.protocols,
    },
    notifications: {
      enabled: obj.notifications?.enabled ?? DEFAULT_SETTINGS.notifications.enabled,
      minutesBefore:
        obj.notifications?.minutesBefore ?? DEFAULT_SETTINGS.notifications.minutesBefore,
      atStart: obj.notifications?.atStart ?? DEFAULT_SETTINGS.notifications.atStart,
      delivery: {
        method: migratedMethod,
        system: {
          urgency:
            delivery?.system?.urgency ??
            oldGlobal?.urgency ??
            DEFAULT_SETTINGS.notifications.delivery.system.urgency,
          timeoutMs:
            delivery?.system?.timeoutMs ??
            oldGlobal?.timeoutMs ??
            DEFAULT_SETTINGS.notifications.delivery.system.timeoutMs,
        },
        popup: {
          timeoutMs: delivery?.popup?.timeoutMs ?? DEFAULT_SETTINGS.notifications.delivery.popup.timeoutMs,
        },
      },
    },
    agenda: {
      maxEvents: obj.agenda?.maxEvents ?? DEFAULT_SETTINGS.agenda.maxEvents,
    },
    log: {
      maxEntries: obj.log?.maxEntries ?? DEFAULT_SETTINGS.log.maxEntries,
      writeToVault: obj.log?.writeToVault ?? DEFAULT_SETTINGS.log.writeToVault,
    },
  };
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
      color: typeof c.color === "string" ? c.color : undefined,
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
      color: typeof c.color === "string" ? c.color : undefined,
    };
  }

  return null;
}

function normalizeCaldavAccount(a: Partial<CaldavAccountConfig>): CaldavAccountConfig | null {
  if (!a || typeof a !== "object") return null;
  if (!a.id || typeof a.id !== "string") return null;
  if (!a.name || typeof a.name !== "string") return null;

  const authMethod =
    a.authMethod === "google_oauth" || a.authMethod === "basic"
      ? a.authMethod
      : "basic";
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

