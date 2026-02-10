import type { CalendarConfig, CaldavAccountConfig } from "../../types";

export type CaldavAccountPatch = Partial<
  Pick<CaldavAccountConfig, "enabled" | "name" | "serverUrl" | "username" | "password" | "authMethod"> & {
    oauth: Partial<NonNullable<CaldavAccountConfig["oauth"]>>;
    resetRefreshToken?: boolean;
  }
>;

export type CalendarPatch = Partial<
  Pick<CalendarConfig, "enabled" | "name" | "type" | "url" | "color" | "colorOverride"> & {
    caldav?: Partial<NonNullable<CalendarConfig["caldav"]>>;
    googleColorLabels?: Record<string, string> | null;
  }
>;

export type SettingsCommand =
  | { type: "caldav.account.add" }
  | { type: "caldav.account.update"; accountId: string; patch: CaldavAccountPatch }
  | { type: "caldav.account.remove"; accountId: string }
  | { type: "calendar.add" }
  | { type: "calendar.add.caldav"; name: string; accountId: string; calendarUrl: string; color?: string }
  | { type: "calendar.update"; calendarId: string; patch: CalendarPatch }
  | { type: "calendar.remove"; calendarId: string }
  | { type: "folders.update"; patch: Partial<AssistantFoldersPatch> }
  | { type: "notifications.update"; patch: Partial<NotificationsPatch> }
  | { type: "recording.update"; patch: Partial<RecordingPatch> }
  | { type: "calendarMeta.update"; patch: Partial<CalendarMetaPatch> }
  | { type: "log.update"; patch: Partial<LogPatch> }
  | { type: "transcription.update"; patch: Partial<TranscriptionPatch> }
  | { type: "debug.update"; enabled: boolean };

export type AssistantFoldersPatch = {
  projects: string;
  people: string;
  calendarEvents: string;
  protocols: string;
};

export type NotificationsPatch = {
  enabled: boolean;
  minutesBefore: number;
  atStart: boolean;
};

export type RecordingPatch = {
  audioBackend: "electron_media_devices" | "g_streamer";
  gstreamerMicSource: string;
  gstreamerMonitorSource: string;
  gstreamerMicProcessing: "none" | "normalize" | "voice";
  gstreamerMonitorProcessing: "none" | "normalize" | "voice";
  gstreamerMicMixLevel: number;
  gstreamerMonitorMixLevel: number;
  electronMicLevel: number;
  chunkMinutes: number;
  autoStartEnabled: boolean;
  autoStartSeconds: number;
};

export type CalendarMetaPatch = {
  autoRefreshEnabled: boolean;
  autoRefreshMinutes: number;
  myEmail: string;
  persistentCacheMaxEventsPerCalendar: number;
};

export type LogPatch = {
  maxEntries: number;
  retentionDays: number;
};

export type TranscriptionPatch = {
  enabled: boolean;
  provider: "nexara";
  nexaraToken: string;
  pollMinutes: number;
};
