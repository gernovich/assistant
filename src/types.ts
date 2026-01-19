export type CalendarSourceType = "ics_url" | "caldav";

export type CalendarId = string;

export interface CalendarConfig {
  id: CalendarId;
  name: string;
  type: CalendarSourceType;
  enabled: boolean;
  url?: string; // for ics_url
  caldav?: {
    accountId: string;
    calendarUrl: string;
  }; // for caldav
  color?: string;
}

export interface CaldavAccountConfig {
  id: string;
  name: string;
  enabled: boolean;
  serverUrl: string;
  username: string;
  password: string; // used only for Basic
  authMethod?: "basic" | "google_oauth";
  oauth?: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  };
}

export interface AssistantSettings {
  debug: {
    enabled: boolean;
  };
  calendars: CalendarConfig[];
  calendar: {
    autoRefreshEnabled: boolean;
    autoRefreshMinutes: number; // default 10
    myEmail: string; // used to detect ACCEPTED/DECLINED for invites (ATTENDEE;PARTSTAT)
  };
  caldav: {
    accounts: CaldavAccountConfig[];
  };
  folders: {
    logs: string;
    projects: string;
    people: string;
    calendarEvents: string;
    protocols: string;
  };
  notifications: {
    enabled: boolean;
    minutesBefore: number; // default 5
    atStart: boolean; // default true
    delivery: {
      method: "obsidian_notice" | "system_notify_send" | "popup_window";
      system: {
        urgency: "low" | "normal" | "critical";
        timeoutMs: number;
      };
      popup: {
        timeoutMs: number;
      };
    };
  };
  agenda: {
    maxEvents: number; // default 50
  };
  log: {
    maxEntries: number; // default 200
    writeToVault: boolean; // default true
  };
}

export interface CalendarEvent {
  calendarId: CalendarId;
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  start: Date;
  end?: Date;
  allDay?: boolean;
  myPartstat?: "accepted" | "declined" | "tentative" | "needs_action";
}

