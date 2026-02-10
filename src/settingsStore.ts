import type { AssistantSettings, CalendarConfig, CaldavAccountConfig } from "./types";
import { RawAssistantSettingsSchema } from "./shared/validation/assistantSettingsSchema";

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
    audioBackend: "electron_media_devices",
    gstreamerMicSource: "auto",
    gstreamerMonitorSource: "auto",
    gstreamerMicProcessing: "none",
    gstreamerMonitorProcessing: "none",
    gstreamerMicMixLevel: 1,
    gstreamerMonitorMixLevel: 1,
    electronMicLevel: 1,
    autoStartEnabled: true,
    autoStartSeconds: 5,
  },
  agenda: {
    maxEvents: 50,
  },
  log: {
    maxEntries: 2048,
    retentionDays: 7,
  },
  transcription: {
    enabled: false,
    provider: "nexara",
    pollMinutes: 20,
    providers: {
      nexara: {
        token: "",
      },
    },
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
  const parsed = RawAssistantSettingsSchema.safeParse(raw ?? {});
  // Важно: schema валидирует RAW persisted settings; здесь дальше идёт нормализация и заполнение defaults.
  // Поэтому работаем с "any" и не привязываемся к точному типу `AssistantSettings` (там нет legacy ключей).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = parsed.success ? parsed.data : {};

  const calendars = Array.isArray(obj.calendars) ? obj.calendars : [];
  const caldavAccounts = Array.isArray(obj.caldav?.accounts) ? obj.caldav?.accounts : [];
  return {
    debug: {
      enabled: obj.debug?.enabled ?? DEFAULT_SETTINGS.debug.enabled,
    },
    calendars: calendars
      .map((c: unknown) => normalizeCalendar(c as Partial<CalendarConfig>))
      .filter((c: unknown): c is CalendarConfig => Boolean(c)),
    calendar: {
      autoRefreshEnabled: obj.calendar?.autoRefreshEnabled ?? DEFAULT_SETTINGS.calendar.autoRefreshEnabled,
      autoRefreshMinutes: normalizeNumber(obj.calendar?.autoRefreshMinutes, {
        defaultValue: DEFAULT_SETTINGS.calendar.autoRefreshMinutes,
        min: 1,
        max: 24 * 60,
      }),
      myEmail: (obj.calendar?.myEmail ?? DEFAULT_SETTINGS.calendar.myEmail).trim(),
      persistentCacheMaxEventsPerCalendar: normalizePersistentCacheMaxEventsPerCalendar(
        obj.calendar?.persistentCacheMaxEventsPerCalendar ?? DEFAULT_SETTINGS.calendar.persistentCacheMaxEventsPerCalendar,
      ),
    },
    caldav: {
      accounts: caldavAccounts
        .map((a: unknown) => normalizeCaldavAccount(a as Partial<CaldavAccountConfig>))
        .filter((a: unknown): a is CaldavAccountConfig => Boolean(a)),
    },
    folders: {
      projects: obj.folders?.projects ?? DEFAULT_SETTINGS.folders.projects,
      people: obj.folders?.people ?? DEFAULT_SETTINGS.folders.people,
      calendarEvents: obj.folders?.calendarEvents ?? DEFAULT_SETTINGS.folders.calendarEvents,
      protocols: obj.folders?.protocols ?? DEFAULT_SETTINGS.folders.protocols,
    },
    notifications: {
      enabled: obj.notifications?.enabled ?? DEFAULT_SETTINGS.notifications.enabled,
      minutesBefore: normalizeNumber(obj.notifications?.minutesBefore, {
        defaultValue: DEFAULT_SETTINGS.notifications.minutesBefore,
        min: 0,
        max: 24 * 60,
      }),
      atStart: obj.notifications?.atStart ?? DEFAULT_SETTINGS.notifications.atStart,
    },
    recording: {
      chunkMinutes: normalizeNumber(obj.recording?.chunkMinutes, {
        defaultValue: DEFAULT_SETTINGS.recording.chunkMinutes,
        min: 1,
        max: 180,
      }),
      audioBackend:
        obj.recording?.audioBackend === "g_streamer"
          ? "g_streamer"
          : obj.recording?.audioBackend === "electron_media_devices" ||
              obj.recording?.audioBackend === "electron_desktop_capturer"
          ? "electron_media_devices"
          : DEFAULT_SETTINGS.recording.audioBackend,
      gstreamerMicSource:
        typeof obj.recording?.gstreamerMicSource === "string" && obj.recording.gstreamerMicSource.trim()
          ? obj.recording.gstreamerMicSource.trim()
          : DEFAULT_SETTINGS.recording.gstreamerMicSource,
      gstreamerMonitorSource:
        typeof obj.recording?.gstreamerMonitorSource === "string" && obj.recording.gstreamerMonitorSource.trim()
          ? obj.recording.gstreamerMonitorSource.trim()
          : DEFAULT_SETTINGS.recording.gstreamerMonitorSource,
      gstreamerMicProcessing:
        obj.recording?.gstreamerMicProcessing === "none" ||
        obj.recording?.gstreamerMicProcessing === "normalize" ||
        obj.recording?.gstreamerMicProcessing === "voice"
          ? obj.recording.gstreamerMicProcessing
          : DEFAULT_SETTINGS.recording.gstreamerMicProcessing,
      gstreamerMonitorProcessing:
        obj.recording?.gstreamerMonitorProcessing === "none" ||
        obj.recording?.gstreamerMonitorProcessing === "normalize" ||
        obj.recording?.gstreamerMonitorProcessing === "voice"
          ? obj.recording.gstreamerMonitorProcessing
          : DEFAULT_SETTINGS.recording.gstreamerMonitorProcessing,
      gstreamerMicMixLevel: normalizeNumber(obj.recording?.gstreamerMicMixLevel, {
        defaultValue: DEFAULT_SETTINGS.recording.gstreamerMicMixLevel,
        min: 0.01,
        max: 2,
      }),
      gstreamerMonitorMixLevel: normalizeNumber(obj.recording?.gstreamerMonitorMixLevel, {
        defaultValue: DEFAULT_SETTINGS.recording.gstreamerMonitorMixLevel,
        min: 0.01,
        max: 2,
      }),
      electronMicLevel: normalizeNumber(obj.recording?.electronMicLevel, {
        defaultValue: DEFAULT_SETTINGS.recording.electronMicLevel,
        min: 0.01,
        max: 2,
      }),
      autoStartEnabled:
        typeof obj.recording?.autoStartEnabled === "boolean" ? obj.recording.autoStartEnabled : DEFAULT_SETTINGS.recording.autoStartEnabled,
      autoStartSeconds: normalizeNumber(obj.recording?.autoStartSeconds, {
        defaultValue: DEFAULT_SETTINGS.recording.autoStartSeconds,
        min: 1,
        max: 60,
      }),
    },
    agenda: {
      maxEvents: normalizeNumber(obj.agenda?.maxEvents, { defaultValue: DEFAULT_SETTINGS.agenda.maxEvents, min: 1, max: 500 }),
    },
    log: {
      maxEntries: normalizeNumber(obj.log?.maxEntries, { defaultValue: DEFAULT_SETTINGS.log.maxEntries, min: 10, max: 20_000 }),
      retentionDays: normalizeRetentionDays(obj.log?.retentionDays ?? DEFAULT_SETTINGS.log.retentionDays),
    },
    transcription: {
      enabled: typeof obj.transcription?.enabled === "boolean" ? obj.transcription.enabled : DEFAULT_SETTINGS.transcription.enabled,
      pollMinutes: normalizeNumber(obj.transcription?.pollMinutes, { defaultValue: DEFAULT_SETTINGS.transcription.pollMinutes, min: 1, max: 24 * 60 }),
      provider: obj.transcription?.provider === "nexara" ? "nexara" : DEFAULT_SETTINGS.transcription.provider,
      providers: {
        nexara: {
          // backward compat: token previously stored at `transcription.token`
          token:
            typeof obj.transcription?.providers?.nexara?.token === "string"
              ? obj.transcription.providers.nexara.token
              : typeof obj.transcription?.token === "string"
                ? obj.transcription.token
                : DEFAULT_SETTINGS.transcription.providers.nexara.token,
        },
      },
    },
  };
}

function normalizeNumber(v: unknown, params: { defaultValue: number; min?: number; max?: number }): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return params.defaultValue;
  const min = typeof params.min === "number" ? params.min : -Infinity;
  const max = typeof params.max === "number" ? params.max : Infinity;
  return Math.min(max, Math.max(min, Math.floor(n)));
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

  const color = typeof (c as any).color === "string" ? String((c as any).color).trim() : "";
  const normColor = color ? color : undefined;
  const colorOverride = typeof (c as any).colorOverride === "string" ? String((c as any).colorOverride).trim() : "";
  const normColorOverride = colorOverride ? colorOverride : undefined;

  const labelsRaw = (c as any).googleColorLabels;
  const normGoogleColorLabels: Record<string, string> | undefined =
    labelsRaw && typeof labelsRaw === "object" && !Array.isArray(labelsRaw)
      ? Object.fromEntries(
          Object.entries(labelsRaw as Record<string, unknown>)
            .map(([k, v]) => [String(k ?? "").trim(), typeof v === "string" ? v.trim() : ""] as const)
            .filter(([k, v]) => Boolean(k) && Boolean(v)),
        )
      : undefined;

  if (c.type === "ics_url") {
    return {
      id: c.id,
      name: c.name,
      type: "ics_url",
      enabled: c.enabled ?? true,
      color: normColor,
      colorOverride: normColorOverride,
      googleColorLabels: normGoogleColorLabels,
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
      color: normColor,
      colorOverride: normColorOverride,
      googleColorLabels: normGoogleColorLabels,
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
