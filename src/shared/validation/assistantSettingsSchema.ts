import { z } from "zod";

/**
 * Runtime-валидация “сырых” настроек из Obsidian `loadData()`.
 *
 * Зачем:
 * - защититься от битого/частично испорченного `data.json`
 * - отфильтровать мусорные типы/ключи до нормализации (defaults/trim/границы)
 *
 * Важно:
 * - схема описывает именно RAW (persisted) формат, где часть чисел может прийти строками
 * - окончательная нормализация делается в `normalizeSettings()`
 */

const zBool = z.boolean();
const zStr = z.string();
const zNumOrStr = z.union([z.number(), z.string()]);

const CalendarConfigSchema = z
  .object({
    id: zStr,
    name: zStr,
    type: z.enum(["ics_url", "caldav"]),
    enabled: zBool.optional(),
    color: zStr.optional(),
    url: zStr.optional(),
    caldav: z
      .object({
        accountId: zStr.optional(),
        calendarUrl: zStr.optional(),
      })
      .optional(),
  })
  .strict();

const CaldavAccountConfigSchema = z
  .object({
    id: zStr,
    name: zStr,
    enabled: zBool.optional(),
    serverUrl: zStr.optional(),
    username: zStr.optional(),
    password: zStr.optional(),
    authMethod: z.enum(["basic", "google_oauth"]).optional(),
    oauth: z
      .object({
        clientId: zStr.optional(),
        clientSecret: zStr.optional(),
        refreshToken: zStr.optional(),
      })
      .optional(),
  })
  .strict();

export const RawAssistantSettingsSchema = z
  .object({
    debug: z
      .object({
        enabled: zBool.optional(),
      })
      .optional(),

    calendars: z.array(CalendarConfigSchema).optional(),
    calendar: z
      .object({
        autoRefreshEnabled: zBool.optional(),
        autoRefreshMinutes: zNumOrStr.optional(),
        myEmail: zStr.optional(),
        persistentCacheMaxEventsPerCalendar: zNumOrStr.optional(),
      })
      .optional(),

    caldav: z
      .object({
        accounts: z.array(CaldavAccountConfigSchema).optional(),
      })
      .optional(),

    folders: z
      .object({
        projects: zStr.optional(),
        people: zStr.optional(),
        calendarEvents: zStr.optional(),
        protocols: zStr.optional(),
      })
      .optional(),

    protocols: z
      .object({
        // Настройки нет (политика протоколов фиксирована), но допускаем её в raw для обратной совместимости:
        // старые `data.json` могут содержать `protocols.subfoldersByMeeting`.
        subfoldersByMeeting: zBool.optional(),
      })
      .optional(),

    notifications: z
      .object({
        enabled: zBool.optional(),
        minutesBefore: zNumOrStr.optional(),
        atStart: zBool.optional(),
      })
      .optional(),

    recording: z
      .object({
        chunkMinutes: zNumOrStr.optional(),
        audioBackend: zStr.optional(),
        gstreamerMicSource: zStr.optional(),
        gstreamerMonitorSource: zStr.optional(),
        gstreamerMicProcessing: zStr.optional(),
        gstreamerMonitorProcessing: zStr.optional(),
        autoStartEnabled: zBool.optional(),
        autoStartSeconds: zNumOrStr.optional(),
      })
      .optional(),

    agenda: z
      .object({
        maxEvents: zNumOrStr.optional(),
      })
      .optional(),

    log: z
      .object({
        maxEntries: zNumOrStr.optional(),
        retentionDays: zNumOrStr.optional(),
      })
      .optional(),
  })
  .strict();

export type RawAssistantSettings = z.infer<typeof RawAssistantSettingsSchema>;
