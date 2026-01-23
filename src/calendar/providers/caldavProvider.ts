import type { AssistantSettings, CalendarConfig, Event } from "../../types";
import type { CalendarProvider } from "./calendarProvider";
import { DAVClient, type DAVAccount, type DAVCalendar, getOauthHeaders } from "tsdav";
import { parseIcs } from "../ics";
import { ensureObsidianFetchInstalled } from "../../caldav/obsidianFetch";
import { getCaldavAccountReadiness } from "../../caldav/caldavReadiness";
import { CALENDAR_EVENTS_HORIZON_DAYS, MS_PER_DAY } from "../constants";
import { AppError } from "../../shared/appError";
import { APP_ERROR } from "../../shared/appErrorCodes";

export class CaldavProvider implements CalendarProvider {
  /** Тип источника календаря, который обслуживает провайдер. */
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
    // Намеренно сохраняем кэш клиентов: пересоздаём его только при ошибке входа
    // (учёт смены учётных данных/сервера без лишнего давления на сеть).
  }

  async refresh(cal: CalendarConfig): Promise<Event[]> {
    const cfg = cal.caldav;
    if (!cfg?.accountId || !cfg.calendarUrl) return [];

    const account = this.settings.caldav.accounts.find((a) => a.id === cfg.accountId);
    if (!account) return [];
    const readiness = getCaldavAccountReadiness(account);
    if (!readiness.ok) return [];

    const client = await this.getOrLoginClient(account);

    const start = new Date();
    const end = new Date(Date.now() + CALENDAR_EVENTS_HORIZON_DAYS * MS_PER_DAY);

    const calendar: DAVCalendar = {
      url: cfg.calendarUrl,
      displayName: cal.name,
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
        return await Promise.reject(new AppError({
          code: APP_ERROR.CALDAV_DISCOVERY,
          message:
            `Ассистент: CalDAV calendarUrl недоступен (HTTP ${first.status} ${first.statusText}). ` +
            "Возможно URL устарел/опечатка — переподключите календарь через «Найти календари».",
          cause: `calendarUrl=${cfg.calendarUrl}`,
        }));
      }
    }

    const runtimeCalendar: import("../../types").Calendar = { id: cal.id, name: cal.name, type: cal.type, config: cal };
    const out: Event[] = [];
    for (const obj of objects) {
      const text = typeof obj.data === "string" ? obj.data : "";
      if (!text) continue;
      out.push(
        ...parseIcs(runtimeCalendar, text, {
          now: new Date(),
          horizonDays: CALENDAR_EVENTS_HORIZON_DAYS,
          // Если пользователь не задал email явно, для CalDAV логин аккаунта — хороший дефолт.
          myEmail: (this.settings.calendar.myEmail || account.username).trim(),
        }),
      );
    }
    return out;
  }

  /**
   * Изменить мой PARTSTAT в календаре (CalDAV write-back).
   *
   * Ограничения MVP:
   * - работает только если в VEVENT есть ATTENDEE для текущего пользователя (email аккаунта/настроек)
   * - обновляем конкретный calendar object через PUT (If-Match по etag)
   */
  async setMyPartstat(cal: CalendarConfig, ev: Event, partstat: NonNullable<Event["status"]>): Promise<void> {
    const cfg = cal.caldav;
    if (!cfg?.accountId || !cfg.calendarUrl) return await Promise.reject(new AppError({ code: APP_ERROR.VALIDATION, message: "Ассистент: CalDAV календарь не настроен" }));

    const account = this.settings.caldav.accounts.find((a) => a.id === cfg.accountId);
    if (!account) return await Promise.reject(new AppError({ code: APP_ERROR.NOT_FOUND, message: "Ассистент: CalDAV аккаунт не найден" }));
    const readiness = getCaldavAccountReadiness(account);
    if (!readiness.ok) return await Promise.reject(new AppError({ code: APP_ERROR.VALIDATION, message: "Ассистент: CalDAV аккаунт не готов (проверьте настройки)" }));

    const client = await this.getOrLoginClient(account);
    const calendar: DAVCalendar = {
      url: cfg.calendarUrl,
      displayName: cal.name,
    };

    // Узкое окно поиска, чтобы не тянуть весь горизонт.
    const start = new Date(ev.start.getTime() - 12 * 60 * 60_000);
    const end = new Date(ev.start.getTime() + 36 * 60 * 60_000);
    const objects = await client.fetchCalendarObjects({
      calendar,
      timeRange: { start: start.toISOString(), end: end.toISOString() },
      expand: false,
      useMultiGet: true,
    });

    const desired = partstatToIcs(partstat);
    const myEmails = splitEmails((this.settings.calendar.myEmail || account.username).trim());
    if (myEmails.length === 0)
      return await Promise.reject(new AppError({ code: APP_ERROR.VALIDATION, message: "Ассистент: невозможно определить мой email для RSVP (проверьте логин/настройки)" }));

    const target = findBestCalendarObject(objects, ev, myEmails);
    if (!target)
      return await Promise.reject(new AppError({
        code: APP_ERROR.NOT_FOUND,
        message: "Ассистент: не удалось найти CalDAV object для этого события (UID/DTSTART не совпали)",
      }));

    const updated = updateMyAttendeePartstatInIcal(String(target.data ?? ""), myEmails, desired);
    if (updated === String(target.data ?? "")) {
      return await Promise.reject(new AppError({
        code: APP_ERROR.VALIDATION,
        message:
          "Ассистент: не удалось обновить PARTSTAT — ATTENDEE для вашего email не найден в VEVENT. " +
          "Обычно это значит, что вы не участник (ATTENDEE) этой встречи.",
        details: { myEmails },
      }));
    }

    const res = await client.updateCalendarObject({
      calendarObject: { ...target, data: updated },
    });
    if (!res.ok) {
      const txt = await safeReadText(res);
      return await Promise.reject(new AppError({
        code: APP_ERROR.CALDAV_WRITEBACK,
        message: `Ассистент: CalDAV write-back не удался (HTTP ${res.status} ${res.statusText})`,
        cause: txt ? String(txt) : undefined,
      }));
    }
  }

  async discoverCalendars(accountId: string): Promise<Array<{ displayName: string; url: string; color?: string }>> {
    const account = this.settings.caldav.accounts.find((a) => a.id === accountId);
    if (!account) return [];
    const readiness = getCaldavAccountReadiness(account);
    if (!readiness.ok) return [];

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
            return await Promise.reject(new AppError({
              code: APP_ERROR.CALDAV_DISCOVERY,
              message:
                "Ассистент: Google CalDAV accessNotConfigured. " +
                "Похоже, в Google Cloud проекте для вашего OAuth Client ID не включён CalDAV API (или он ещё не активировался). " +
                "Включите «CalDAV API», подождите 5–10 минут и повторите discovery.",
              cause: raw,
            }));
          }
          return await Promise.reject(new AppError({
            code: APP_ERROR.CALDAV_DISCOVERY,
            message: `Ассистент: CalDAV PROPFIND не удался (HTTP ${first.status} ${first.statusText})`,
            cause: raw || undefined,
          }));
        }
      }
    }

    // Google CalDAV: иногда PROPFIND-based discovery возвращает 0 календарей (особенности сервера/политик).
    // Практичный fallback: основной календарь обычно живёт по /events/.
    if (cals.length === 0 && (account.authMethod ?? "basic") === "google_oauth" && isGoogleCaldavServerUrl(account.serverUrl)) {
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
      color: typeof (c as any).calendarColor === "string" ? String((c as any).calendarColor) : undefined,
    }));
  }

  private async getOrLoginClient(account: AssistantSettings["caldav"]["accounts"][number]): Promise<DAVClient> {
    let client = this.clientByAccountId.get(account.id);
    if (!client) {
      client = this.createClient(account);
      this.clientByAccountId.set(account.id, client);
    }

    try {
      await client.login();
      return client;
    } catch (e) {
      // Учёт смены данных/сервера: пересоздаём клиент и повторяем один раз.
      const fresh = this.createClient(account);
      this.clientByAccountId.set(account.id, fresh);
      try {
        await fresh.login();
        return fresh;
      } catch (e2) {
        const msg = String((e2 as unknown) ?? "неизвестная ошибка");
        const method = account.authMethod ?? "basic";
        return await Promise.reject(new AppError({
          code: APP_ERROR.CALDAV_AUTH,
          message: "Ассистент: CalDAV вход не удался (проверьте настройки аккаунта)",
          cause: `method=${method}, serverUrl=${account.serverUrl}, error=${msg}`,
        }));
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
        // ВАЖНО (UX): не модифицируем пароль автоматически.
        // Если Google показывает пароль приложения с пробелами — ожидаем ввод без пробелов (есть подсказка в настройках).
        password: account.password,
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

function splitEmails(raw: string): string[] {
  return raw
    .split(/[,\s;]+/g)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeMailto(v: string): string {
  const s = String(v ?? "").trim();
  const m = s.match(/^mailto:(.+)$/i);
  return (m ? m[1] : s).trim().toLowerCase();
}

function partstatToIcs(ps: NonNullable<Event["status"]>): string {
  if (ps === "accepted") return "ACCEPTED";
  if (ps === "declined") return "DECLINED";
  if (ps === "tentative") return "TENTATIVE";
  return "NEEDS-ACTION";
}

type CalendarObject = { url: string; etag?: string; data?: unknown };

function findBestCalendarObject(objects: CalendarObject[], ev: Event, myEmails: string[]): CalendarObject | null {
  const startMs = ev.start.getTime();
  const uid = String(ev.id ?? "").trim();
  if (!uid) return null;

  // Occurrence: если у события есть recurrenceId — стараемся матчитить именно override по RECURRENCE-ID.
  // Это важно для write-back по конкретной дате повторяющейся встречи.
  const wantRecurrenceIdRaw = String(ev.recurrence?.recurrenceId ?? "").trim();
  const wantRecurrenceMs = wantRecurrenceIdRaw ? parseIcsDateMs(wantRecurrenceIdRaw) : null;

  let best: { obj: CalendarObject; score: number } | null = null;
  for (const obj of objects) {
    const text = String(obj.data ?? "");
    if (!text) continue;
    const blocks = extractVevents(text);
    for (const b of blocks) {
      const buid = getIcsProp(b, "UID");
      if (!buid || buid.trim() !== uid) continue;
      const dt = getIcsProp(b, "DTSTART");
      if (!dt) continue;
      const dtMs = parseIcsDateMs(dt);
      if (dtMs == null) continue;
      // Ищем VEVENT с совпадающим DTSTART (обычно это override-экземпляр или отдельный object).
      // Если совпадения нет, fallback на master (по UID) тоже допустим, но с меньшим приоритетом.
      const sameStart = dtMs === startMs;
      const hasMe = hasAttendeeForAnyEmail(b, myEmails);
      let score = (sameStart ? 10 : 0) + (hasMe ? 2 : 0) + (text.length > 0 ? 1 : 0);

      if (wantRecurrenceMs != null) {
        const rid = getIcsProp(b, "RECURRENCE-ID");
        const ridMs = rid ? parseIcsDateMs(rid) : null;
        if (ridMs != null && ridMs === wantRecurrenceMs) score += 100;
        else if (ridMs == null) score -= 10; // master пенализируем, если ждём override
      }

      if (!best || score > best.score) best = { obj, score };
    }
  }
  return best?.obj ?? null;
}

function extractVevents(ical: string): string[] {
  const out: string[] = [];
  const re = /BEGIN:VEVENT[\s\S]*?\nEND:VEVENT/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ical))) out.push(m[0]);
  return out;
}

function getIcsProp(block: string, name: string): string | null {
  const re = new RegExp(`^${name}(;[^:]*)?:(.*)$`, "im");
  const m = block.match(re);
  return m ? String(m[2] ?? "").trim() : null;
}

function hasAttendeeForAnyEmail(block: string, emails: string[]): boolean {
  const re = /^ATTENDEE(?:;[^:]*)?:(.*)$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const v = normalizeMailto(String(m[1] ?? ""));
    if (v && emails.includes(v)) return true;
  }
  return false;
}

function updateMyAttendeePartstatInIcal(ical: string, myEmails: string[], desiredPartstat: string): string {
  // Обновляем все VEVENT в объекте (некоторые серверы держат один VEVENT на объект, но лучше не предполагать).
  return ical.replace(/BEGIN:VEVENT[\s\S]*?\nEND:VEVENT/gm, (ve) => updateMyAttendeePartstatInVevent(ve, myEmails, desiredPartstat));
}

function updateMyAttendeePartstatInVevent(vevent: string, myEmails: string[], desiredPartstat: string): string {
  const lines = vevent.split("\n");
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!/^ATTENDEE/i.test(line)) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const left = line.slice(0, idx);
    const right = line.slice(idx + 1);
    const email = normalizeMailto(right);
    if (!email || !myEmails.includes(email)) continue;

    // Удаляем старый PARTSTAT и вставляем новый.
    const without = left.replace(/;PARTSTAT=[^;:]*/gi, "");
    lines[i] = `${without};PARTSTAT=${desiredPartstat}:${right}`;
    changed = true;
    break;
  }
  return changed ? lines.join("\n") : vevent;
}

function parseIcsDateMs(v: string): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  // YYYYMMDD
  if (/^\d{8}$/.test(s)) {
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(4, 6)) - 1;
    const d = Number(s.slice(6, 8));
    const dt = new Date(y, m, d, 0, 0, 0, 0);
    const ms = dt.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const hh = Number(m[4]);
  const mm = Number(m[5]);
  const ss = m[6] ? Number(m[6]) : 0;
  const isUtc = Boolean(m[7]);
  const dt = isUtc ? new Date(Date.UTC(y, mo, d, hh, mm, ss, 0)) : new Date(y, mo, d, hh, mm, ss, 0);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : null;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    const s = String(t ?? "").trim();
    return s.length > 300 ? `${s.slice(0, 300)}…` : s;
  } catch {
    return "";
  }
}
