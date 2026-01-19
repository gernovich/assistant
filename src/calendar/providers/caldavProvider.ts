import type { AssistantSettings, CalendarConfig, CalendarEvent } from "../../types";
import type { CalendarProvider } from "./calendarProvider";
import { DAVClient, type DAVAccount, type DAVCalendar, getOauthHeaders } from "tsdav";
import { parseIcs } from "../ics";
import { ensureObsidianFetchInstalled } from "../../caldav/obsidianFetch";

export class CaldavProvider implements CalendarProvider {
  type: CalendarConfig["type"] = "caldav";

  /**
   * CalDAV provider (tsdav) — заметки по граблям/нюансам (особенно Google CalDAV).
   *
   * 1) Google CalDAV v2: serverUrl ДОЛЖЕН быть корнем:
   *    - ✅ https://apidata.googleusercontent.com/caldav/v2/
   *    - ❌ https://apidata.googleusercontent.com/caldav/v2/<email>/
   *    Если добавить email в конец serverUrl, tsdav discovery/login может падать с "cannot find homeUrl"
   *    или давать непредсказуемые результаты.
   *
   * 2) Google Cloud API: для OAuth клиента нужен включённый "CalDAV API"
   *    (не путать с "Google Calendar API"). Если API выключен/не активировался:
   *    - типичная ошибка: 403 + accessNotConfigured (часто с project number в тексте).
   *    - после включения иногда нужно подождать 5–10 минут.
   *
   * 3) Выбор календаря: Google часто отдаёт несколько calendars (основной + "Праздники ...").
   *    В UI мы подсвечиваем основной (displayName == login/email) и помечаем "праздники" как необязательные.
   *
   * 4) "0 событий без ошибки": для неправильного calendarUrl (например опечатка в email или устаревший URL)
   *    Google может возвращать 0 calendar objects без явного exception. Поэтому при objects.length === 0
   *    делаем PROPFIND на calendarUrl и выдаём явную ошибку, если URL не живой.
   *
   * 5) Obsidian/Electron network: tsdav использует fetch. В Obsidian стандартный fetch/cross-fetch может
   *    давать "TypeError: Failed to fetch" (CORS/transport). Мы устанавливаем fetch через
   *    Obsidian `requestUrl` (см. ensureObsidianFetchInstalled + alias cross-fetch в esbuild).
   *
   * 6) Google Basic auth: в ряде доменов/политик может не работать даже с app-password.
   *    В UX предупреждаем; пароль из Google часто копируется с пробелами — сервер ожидает без пробелов.
   */
  private settings: AssistantSettings;
  private clientByAccountId = new Map<string, DAVClient>();

  constructor(settings: AssistantSettings) {
    this.settings = settings;
    ensureObsidianFetchInstalled();
  }

  setSettings(settings: AssistantSettings) {
    this.settings = settings;
    // Intentionally keep clients cache; credentials might change though.
    // We will recreate a client if login fails.
  }

  async refresh(cal: CalendarConfig): Promise<CalendarEvent[]> {
    const cfg = cal.caldav;
    if (!cfg?.accountId || !cfg.calendarUrl) return [];

    const account = this.settings.caldav.accounts.find((a) => a.id === cfg.accountId);
    if (!account || !account.enabled) return [];
    if (!account.serverUrl || !account.username) return [];
    if ((account.authMethod ?? "basic") === "basic" && !account.password) return [];
    if ((account.authMethod ?? "basic") === "google_oauth" && !account.oauth?.refreshToken) return [];

    const client = await this.getOrLoginClient(account);

    const start = new Date();
    const end = new Date(Date.now() + 60 * 24 * 60 * 60_000); // 60 days

    const calendar: DAVCalendar = {
      url: cfg.calendarUrl,
      displayName: cal.name,
      calendarColor: cal.color,
    };

    const objects = await client.fetchCalendarObjects({
      calendar,
      timeRange: { start: start.toISOString(), end: end.toISOString() },
      expand: false,
      useMultiGet: true,
    });

    // tsdav иногда возвращает [] без исключения, если calendar.url неправильный (404) —
    // например, если в URL сохранилась опечатка или устаревший discovery-URL.
    // Проверяем "живость" calendarUrl, чтобы не молчать с events=0.
    if (objects.length === 0) {
      const probe = await client.propfind({
        url: cfg.calendarUrl,
        depth: "0",
        props: {
          "d:resourcetype": {},
          "d:displayname": {},
        },
      });
      const first = probe[0];
      if (first && !first.ok) {
        throw new Error(
          `CalDAV calendarUrl недоступен: HTTP ${first.status} ${first.statusText}. ` +
            `Возможно URL устарел/опечатка — переподключите календарь через «Найти календари». ` +
            `calendarUrl=${cfg.calendarUrl}`,
        );
      }
    }

    const out: CalendarEvent[] = [];
    for (const obj of objects) {
      const text = typeof obj.data === "string" ? obj.data : "";
      if (!text) continue;
      out.push(
        ...parseIcs(cal.id, text, {
          now: new Date(),
          horizonDays: 60,
          myEmail: this.settings.calendar.myEmail,
        }),
      );
    }
    return out;
  }

  async discoverCalendars(accountId: string): Promise<Array<{ displayName: string; url: string; color?: string }>> {
    const account = this.settings.caldav.accounts.find((a) => a.id === accountId);
    if (!account || !account.enabled) return [];
    if (!account.serverUrl || !account.username) return [];
    if ((account.authMethod ?? "basic") === "basic" && !account.password) return [];
    if ((account.authMethod ?? "basic") === "google_oauth" && !account.oauth?.refreshToken) return [];

    const client = await this.getOrLoginClient(account);
    const cals = await client.fetchCalendars();

    if (cals.length === 0) {
      const homeUrl = client.account?.homeUrl;
      if (homeUrl) {
        const probe = await client.propfind({
          url: homeUrl,
          depth: "0",
          props: {
            "d:resourcetype": {},
            "d:displayname": {},
          },
        });
        const first = probe[0];
        if (first && !first.ok) {
          const raw = String(first.raw ?? "");
          if (first.status === 403 && raw.includes("accessNotConfigured")) {
            throw new Error(
              "Google CalDAV: accessNotConfigured. " +
                "Похоже, в Google Cloud проекте для вашего OAuth Client ID не включён CalDAV API (или он ещё не активировался). " +
                "Откройте Google Cloud Console → APIs & Services → Library → найдите «CalDAV API» → Enable " +
                "(в том же проекте, где создан OAuth Client ID; в ошибке обычно указан project number). " +
                "После включения подождите 5–10 минут и повторите discovery.",
            );
          }
          throw new Error(`CalDAV PROPFIND failed: HTTP ${first.status} ${first.statusText}`);
        }
      }
    }

    // Google CalDAV: sometimes PROPFIND-based discovery returns 0 calendars depending on server behavior/policies.
    // Provide a practical fallback: primary calendar lives under /events/.
    if (
      cals.length === 0 &&
      (account.authMethod ?? "basic") === "google_oauth" &&
      isGoogleCaldavServerUrl(account.serverUrl)
    ) {
      return [
        {
          displayName: "Primary (Google)",
          url: googlePrimaryEventsUrl(account.username),
        },
      ];
    }

    return cals.map((c) => ({
      displayName: String(c.displayName ?? "Календарь"),
      url: String(c.url ?? ""),
      color: typeof c.calendarColor === "string" ? c.calendarColor : undefined,
    }));
  }

  private async getOrLoginClient(
    account: AssistantSettings["caldav"]["accounts"][number],
  ): Promise<DAVClient> {
    let client = this.clientByAccountId.get(account.id);
    if (!client) {
      client = this.createClient(account);
      this.clientByAccountId.set(account.id, client);
    }

    try {
      await client.login();
      return client;
    } catch (e) {
      // Credentials/server might have changed — recreate and retry once.
      const fresh = this.createClient(account);
      this.clientByAccountId.set(account.id, fresh);
      try {
        await fresh.login();
        return fresh;
      } catch (e2) {
        const msg = String((e2 as unknown) ?? "unknown");
        const method = account.authMethod ?? "basic";
        throw new Error(`CalDAV login failed (${method}, serverUrl=${account.serverUrl}): ${msg}`);
      }
    }
  }

  private createClient(account: AssistantSettings["caldav"]["accounts"][number]): DAVClient {
    ensureObsidianFetchInstalled();
    const authMethod = account.authMethod ?? "basic";

    if (authMethod === "google_oauth") {
      const oauth = account.oauth ?? { clientId: "", clientSecret: "", refreshToken: "" };
      return new DAVClient({
        serverUrl: account.serverUrl,
        credentials: {
          tokenUrl: "https://oauth2.googleapis.com/token",
          username: account.username,
          refreshToken: oauth.refreshToken,
          clientId: oauth.clientId,
          clientSecret: oauth.clientSecret,
        },
        authMethod: "Oauth",
        defaultAccountType: "caldav",
      });
    }

    return new DAVClient({
      serverUrl: account.serverUrl,
      credentials: {
        username: account.username,
        // Google app-password is often copied with spaces; server expects it without spaces.
        password: isGoogleCaldavServerUrl(account.serverUrl) ? account.password.replaceAll(" ", "") : account.password,
      },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });
  }

}

function isGoogleCaldavServerUrl(url: string): boolean {
  const u = (url ?? "").trim();
  if (!u) return false;
  return u.includes("apidata.googleusercontent.com/caldav/v2");
}

const GOOGLE_CALDAV_ROOT_URL = "https://apidata.googleusercontent.com/caldav/v2/";

function googlePrimaryEventsUrl(email: string): string {
  const e = (email ?? "").trim();
  return `${GOOGLE_CALDAV_ROOT_URL}${encodeURIComponent(e)}/events/`;
}
