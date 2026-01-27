import type { AssistantSettings } from "../../types";
import { makePseudoRandomId } from "../../domain/policies/pseudoRandomId";
import type { SettingsCommand } from "./settingsCommands";
import type { UpdateSettingsUseCase } from "./updateSettingsUseCase";

const GOOGLE_CALDAV_SERVER_URL = "https://apidata.googleusercontent.com/caldav/v2/";
const DEFAULT_FOLDERS = {
  projects: "Ассистент/Проекты",
  people: "Ассистент/Люди",
  calendarEvents: "Ассистент/Встречи",
  protocols: "Ассистент/Протоколы",
};

export class ApplySettingsCommandUseCase {
  constructor(
    private readonly deps: {
      updateSettings: UpdateSettingsUseCase;
      nowMs: () => number;
      randomHex: () => string;
    },
  ) {}

  async execute(cmd: SettingsCommand): Promise<void> {
    await this.deps.updateSettings.update((s) => {
      applySettingsCommandMutate(s, cmd, { nowMs: this.deps.nowMs(), randomHex: this.deps.randomHex() });
    });
  }
}

function applySettingsCommandMutate(s: AssistantSettings, cmd: SettingsCommand, idCtx: { nowMs: number; randomHex: string }): void {
  switch (cmd.type) {
    case "caldav.account.add": {
      const id = makePseudoRandomId({ prefix: "caldav", nowMs: idCtx.nowMs, randomHex: idCtx.randomHex });
      s.caldav.accounts.push({
        id,
        name: "CalDAV",
        enabled: true,
        serverUrl: "",
        username: "",
        password: "",
        authMethod: "basic",
      });
      return;
    }

    case "caldav.account.update": {
      const acc = s.caldav.accounts.find((a) => a.id === cmd.accountId);
      if (!acc) return;

      const p = cmd.patch;
      if (typeof p.enabled === "boolean") acc.enabled = p.enabled;
      if (typeof p.name === "string") acc.name = p.name;
      if (typeof p.serverUrl === "string") acc.serverUrl = p.serverUrl;
      if (typeof p.username === "string") acc.username = p.username;
      if (typeof p.password === "string") acc.password = p.password;
      if (p.authMethod === "basic" || p.authMethod === "google_oauth") acc.authMethod = p.authMethod;

      if (p.oauth) {
        acc.oauth = acc.oauth ?? { clientId: "", clientSecret: "", refreshToken: "" };
        if (typeof p.oauth.clientId === "string") acc.oauth.clientId = p.oauth.clientId;
        if (typeof p.oauth.clientSecret === "string") acc.oauth.clientSecret = p.oauth.clientSecret;
        if (typeof p.oauth.refreshToken === "string") acc.oauth.refreshToken = p.oauth.refreshToken;
      }
      if (p.resetRefreshToken === true) {
        acc.oauth = acc.oauth ?? { clientId: "", clientSecret: "", refreshToken: "" };
        acc.oauth.refreshToken = "";
      }

      // Обратная совместимость по пользовательскому опыту: если выбрали Google OAuth и serverUrl пустой — подставим корень.
      if ((acc.authMethod ?? "basic") === "google_oauth" && !String(acc.serverUrl ?? "").trim()) {
        acc.serverUrl = GOOGLE_CALDAV_SERVER_URL;
      }
      // Google‑корень фиксируем (как и раньше в интерфейсе): если authMethod=google_oauth — ставим корень.
      if ((acc.authMethod ?? "basic") === "google_oauth") {
        acc.serverUrl = GOOGLE_CALDAV_SERVER_URL;
      }
      return;
    }

    case "caldav.account.remove": {
      s.caldav.accounts = s.caldav.accounts.filter((a) => a.id !== cmd.accountId);
      for (const cal of s.calendars) {
        if (cal.type === "caldav" && cal.caldav?.accountId === cmd.accountId) {
          cal.enabled = false;
        }
      }
      return;
    }

    case "calendar.add": {
      const id = makePseudoRandomId({ prefix: "cal", nowMs: idCtx.nowMs, randomHex: idCtx.randomHex });
      s.calendars.push({
        id,
        name: "Календарь",
        type: "ics_url",
        enabled: true,
        color: undefined,
        url: "",
      });
      return;
    }

    case "calendar.add.caldav": {
      const id = makePseudoRandomId({ prefix: "cal", nowMs: idCtx.nowMs, randomHex: idCtx.randomHex });
      const color = typeof cmd.color === "string" ? cmd.color.trim() : "";
      s.calendars.push({
        id,
        name: String(cmd.name || "Календарь"),
        type: "caldav",
        enabled: true,
        color: color ? color : undefined,
        caldav: {
          accountId: String(cmd.accountId || ""),
          calendarUrl: String(cmd.calendarUrl || ""),
        },
      });
      return;
    }

    case "calendar.update": {
      const cal = s.calendars.find((c) => c.id === cmd.calendarId);
      if (!cal) return;

      const p = cmd.patch;
      if (typeof p.enabled === "boolean") cal.enabled = p.enabled;
      if (typeof p.name === "string") cal.name = p.name;
      if (typeof p.color === "string") {
        const v = p.color.trim();
        cal.color = v ? v : undefined;
      }

      if (p.type === "ics_url" || p.type === "caldav") {
        const next = p.type;
        if (cal.type !== next) {
          cal.type = next;
          if (next === "ics_url") {
            cal.url = cal.url ?? "";
            cal.caldav = undefined;
          } else {
            cal.caldav = cal.caldav ?? { accountId: "", calendarUrl: "" };
            cal.url = undefined;
          }
        }
      }

      if (typeof p.url === "string") cal.url = p.url;
      if (p.caldav) {
        cal.caldav = cal.caldav ?? { accountId: "", calendarUrl: "" };
        if (typeof p.caldav.accountId === "string") cal.caldav.accountId = p.caldav.accountId;
        if (typeof p.caldav.calendarUrl === "string") cal.caldav.calendarUrl = p.caldav.calendarUrl;
      }
      return;
    }

    case "calendar.remove": {
      s.calendars = s.calendars.filter((c) => c.id !== cmd.calendarId);
      return;
    }

    case "folders.update": {
      const p = cmd.patch ?? {};
      if (typeof p.projects === "string") s.folders.projects = normalizeFolderPath(p.projects, DEFAULT_FOLDERS.projects);
      if (typeof p.people === "string") s.folders.people = normalizeFolderPath(p.people, DEFAULT_FOLDERS.people);
      if (typeof p.calendarEvents === "string")
        s.folders.calendarEvents = normalizeFolderPath(p.calendarEvents, DEFAULT_FOLDERS.calendarEvents);
      if (typeof p.protocols === "string") s.folders.protocols = normalizeFolderPath(p.protocols, DEFAULT_FOLDERS.protocols);
      return;
    }

    case "notifications.update": {
      const p = cmd.patch ?? {};
      if (typeof p.enabled === "boolean") s.notifications.enabled = p.enabled;
      if (typeof p.atStart === "boolean") s.notifications.atStart = p.atStart;
      if (typeof p.minutesBefore === "number") s.notifications.minutesBefore = sanitizeNumber(p.minutesBefore, 5, { min: 0, max: 24 * 60 });
      return;
    }

    case "recording.update": {
      const p = cmd.patch ?? {};
      if (p.audioBackend === "electron_media_devices" || p.audioBackend === "g_streamer") s.recording.audioBackend = p.audioBackend;
      if (typeof p.gstreamerMicSource === "string") s.recording.gstreamerMicSource = p.gstreamerMicSource.trim() || "auto";
      if (typeof p.gstreamerMonitorSource === "string") s.recording.gstreamerMonitorSource = p.gstreamerMonitorSource.trim() || "auto";
      if (p.gstreamerMicProcessing === "none" || p.gstreamerMicProcessing === "normalize" || p.gstreamerMicProcessing === "voice")
        s.recording.gstreamerMicProcessing = p.gstreamerMicProcessing;
      if (
        p.gstreamerMonitorProcessing === "none" ||
        p.gstreamerMonitorProcessing === "normalize" ||
        p.gstreamerMonitorProcessing === "voice"
      )
        s.recording.gstreamerMonitorProcessing = p.gstreamerMonitorProcessing;
      if (typeof p.chunkMinutes === "number") s.recording.chunkMinutes = sanitizePositiveOrDefault(p.chunkMinutes, 5, { max: 180 });
      if (typeof p.autoStartEnabled === "boolean") s.recording.autoStartEnabled = p.autoStartEnabled;
      if (typeof p.autoStartSeconds === "number")
        s.recording.autoStartSeconds = sanitizePositiveOrDefault(p.autoStartSeconds, 5, { max: 60 });
      return;
    }

    case "calendarMeta.update": {
      const p = cmd.patch ?? {};
      if (typeof p.autoRefreshEnabled === "boolean") s.calendar.autoRefreshEnabled = p.autoRefreshEnabled;
      if (typeof p.autoRefreshMinutes === "number")
        s.calendar.autoRefreshMinutes = sanitizeNumber(p.autoRefreshMinutes, 10, { min: 1, max: 24 * 60 });
      if (typeof p.myEmail === "string") s.calendar.myEmail = String(p.myEmail ?? "").trim();
      if (typeof p.persistentCacheMaxEventsPerCalendar === "number")
        s.calendar.persistentCacheMaxEventsPerCalendar = sanitizeNumber(p.persistentCacheMaxEventsPerCalendar, 2000, {
          min: 1,
          max: 100000,
        });
      return;
    }

    case "log.update": {
      const p = cmd.patch ?? {};
      if (typeof p.maxEntries === "number") s.log.maxEntries = sanitizeNumber(p.maxEntries, 2048, { min: 10, max: 20000 });
      if (typeof p.retentionDays === "number") s.log.retentionDays = sanitizeNumber(p.retentionDays, 7, { min: 1, max: 365 });
      return;
    }

    case "debug.update": {
      s.debug.enabled = Boolean(cmd.enabled);
      return;
    }
  }
}

function normalizeFolderPath(v: string, defaultValue: string): string {
  const s = String(v ?? "").trim();
  return s || defaultValue;
}

function sanitizeNumber(v: number, defaultValue: number, bounds?: { min?: number; max?: number }): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return defaultValue;
  const floored = Math.floor(n);
  const min = typeof bounds?.min === "number" ? bounds.min : -Infinity;
  const max = typeof bounds?.max === "number" ? bounds.max : Infinity;
  return Math.min(max, Math.max(min, floored));
}

function sanitizePositiveOrDefault(v: number, defaultValue: number, bounds?: { max?: number }): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return defaultValue;
  const floored = Math.floor(n);
  if (floored <= 0) return defaultValue;
  const max = typeof bounds?.max === "number" ? bounds.max : Infinity;
  return Math.min(max, floored);
}
