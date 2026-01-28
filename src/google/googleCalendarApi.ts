import { requestUrl } from "obsidian";
import type { CaldavAccountConfig, Event } from "../types";
import { AppError } from "../shared/appError";
import { APP_ERROR } from "../shared/appErrorCodes";

type TokenCacheEntry = { accessToken: string; expiresAtMs: number };
type ColorsCacheEntry = { fetchedAtMs: number; colors: GoogleColorsGetResponse };

type GoogleColorsGetResponse = {
  event?: Record<string, { background?: string; foreground?: string }>;
  calendar?: Record<string, { background?: string; foreground?: string }>;
};

type GoogleEventsListResponse = {
  items?: Array<{
    id?: string;
    iCalUID?: string;
    colorId?: string;
    recurringEventId?: string;
    recurrence?: string[];
  }>;
  nextPageToken?: string;
};

function toIso(v: Date): string {
  return v.toISOString();
}

function normalizeHex(v: string): string {
  const s = String(v ?? "").trim();
  return s.toLowerCase();
}

export function parseGoogleCalendarIdFromCaldavCalendarUrl(calendarUrl: string): string | null {
  const raw = String(calendarUrl ?? "").trim();
  if (!raw) return null;
  // Google CalDAV v2 calendarUrl обычно: https://apidata.googleusercontent.com/caldav/v2/<calendarId>/events/
  const m = raw.match(/\/caldav\/v2\/([^/]+)\/events\/?$/i);
  if (!m) return null;
  try {
    return decodeURIComponent(String(m[1] ?? ""));
  } catch {
    return String(m[1] ?? "");
  }
}

function isGoogleOauthAccount(acc: CaldavAccountConfig): boolean {
  if ((acc.authMethod ?? "basic") !== "google_oauth") return false;
  const oauth = acc.oauth ?? { clientId: "", clientSecret: "", refreshToken: "" };
  return Boolean(oauth.clientId && oauth.clientSecret && oauth.refreshToken);
}

async function googleTokenFromRefresh(params: { clientId: string; clientSecret: string; refreshToken: string }): Promise<{
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: params.clientId,
    client_secret: params.clientSecret,
    refresh_token: params.refreshToken,
  }).toString();

  const res = await requestUrl({
    url: "https://oauth2.googleapis.com/token",
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    throw: false,
  });

  const txt = String(res.text ?? "");
  try {
    return JSON.parse(txt) as any;
  } catch {
    return { error: "invalid_json", error_description: txt.slice(0, 200) };
  }
}

async function googleJson<T>(params: { url: string; method?: string; token: string; body?: unknown }): Promise<T> {
  const method = (params.method ?? "GET").toUpperCase();
  const body = params.body == null ? undefined : JSON.stringify(params.body);
  const res = await requestUrl({
    url: params.url,
    method,
    headers: {
      authorization: `Bearer ${params.token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body,
    throw: false,
  });

  const status = Number(res.status ?? 0);
  const txt = String(res.text ?? "");
  if (status < 200 || status >= 300) {
    // Google обычно отдаёт JSON с error.message/reason.
    const short = txt.length > 800 ? `${txt.slice(0, 800)}…` : txt;
    // Отдельно подсвечиваем типичную проблему: Calendar API не включён в проекте.
    const hint =
      status === 403 && (short.includes("accessNotConfigured") || short.includes("Calendar API") || short.includes("calendar") || short.includes("Google Calendar API"))
        ? "Похоже, в Google Cloud проекте не включён «Google Calendar API». Включите его и подождите 5–10 минут."
        : "";
    return await Promise.reject(
      new AppError({
        code: APP_ERROR.NETWORK,
        message: `Ассистент: Google Calendar API ошибка (HTTP ${status})${hint ? `. ${hint}` : ""}`,
        cause: short,
      }),
    );
  }
  try {
    return JSON.parse(txt || "{}") as T;
  } catch (e) {
    return await Promise.reject(
      new AppError({
        code: APP_ERROR.NETWORK,
        message: "Ассистент: Google Calendar API вернул некорректный JSON",
        cause: txt.slice(0, 400),
      }),
    );
  }
}

export class GoogleCalendarApi {
  private tokenByAccountId = new Map<string, TokenCacheEntry>();
  private colorsByAccountId = new Map<string, ColorsCacheEntry>();

  private async getAccessToken(acc: CaldavAccountConfig): Promise<string> {
    if (!isGoogleOauthAccount(acc))
      return await Promise.reject(new AppError({ code: APP_ERROR.VALIDATION, message: "Ассистент: Google OAuth аккаунт не готов (нет refresh_token)" }));

    const cached = this.tokenByAccountId.get(acc.id);
    if (cached && cached.expiresAtMs > Date.now() + 30_000) return cached.accessToken;

    const oauth = acc.oauth ?? { clientId: "", clientSecret: "", refreshToken: "" };
    const tok = await googleTokenFromRefresh({
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      refreshToken: oauth.refreshToken,
    });
    const at = String(tok.access_token ?? "");
    const exp = Number(tok.expires_in ?? 0) || 0;
    if (!at || exp <= 0) {
      const desc = tok.error_description ? ` (${tok.error_description})` : "";
      return await Promise.reject(
        new AppError({
          code: APP_ERROR.CALDAV_AUTH,
          message: `Ассистент: не удалось получить access_token из refresh_token${desc}`,
          cause: tok.error ? String(tok.error) : undefined,
        }),
      );
    }

    this.tokenByAccountId.set(acc.id, { accessToken: at, expiresAtMs: Date.now() + exp * 1000 });
    return at;
  }

  async getColors(acc: CaldavAccountConfig): Promise<GoogleColorsGetResponse> {
    const cached = this.colorsByAccountId.get(acc.id);
    if (cached && Date.now() - cached.fetchedAtMs < 6 * 60 * 60_000) return cached.colors;
    const token = await this.getAccessToken(acc);
    const colors = await googleJson<GoogleColorsGetResponse>({
      url: "https://www.googleapis.com/calendar/v3/colors",
      token,
    });
    this.colorsByAccountId.set(acc.id, { fetchedAtMs: Date.now(), colors });
    return colors;
  }

  private async listEventsPage(params: {
    acc: CaldavAccountConfig;
    calendarId: string;
    query: Record<string, string>;
  }): Promise<GoogleEventsListResponse> {
    const token = await this.getAccessToken(params.acc);
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.calendarId)}/events`);
    for (const [k, v] of Object.entries(params.query)) url.searchParams.set(k, v);
    return await googleJson<GoogleEventsListResponse>({ url: url.toString(), token });
  }

  async listEventColorsInRange(params: {
    acc: CaldavAccountConfig;
    calendarId: string;
    timeMinIso: string;
    timeMaxIso: string;
  }): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    let pageToken = "";
    let guard = 0;
    while (guard++ < 50) {
      const r = await this.listEventsPage({
        acc: params.acc,
        calendarId: params.calendarId,
        query: {
          timeMin: params.timeMinIso,
          timeMax: params.timeMaxIso,
          singleEvents: "true",
          showDeleted: "false",
          maxResults: "2500",
          fields: "items(iCalUID,colorId),nextPageToken",
          ...(pageToken ? { pageToken } : {}),
        },
      });
      for (const it of r.items ?? []) {
        const uid = String((it as any).iCalUID ?? "").trim();
        const cid = String((it as any).colorId ?? "").trim();
        if (!uid || !cid) continue;
        // Если встреча уже была записана (например другой instance), оставляем первое значение.
        if (!out.has(uid)) out.set(uid, cid);
      }
      pageToken = String(r.nextPageToken ?? "").trim();
      if (!pageToken) break;
    }
    return out;
  }

  async findMasterGoogleEventIdByIcalUid(params: { acc: CaldavAccountConfig; calendarId: string; iCalUid: string }): Promise<string> {
    const uid = String(params.iCalUid ?? "").trim();
    if (!uid) return await Promise.reject(new AppError({ code: APP_ERROR.VALIDATION, message: "Ассистент: пустой iCalUID" }));

    const r = await this.listEventsPage({
      acc: params.acc,
      calendarId: params.calendarId,
      query: {
        iCalUID: uid,
        singleEvents: "false",
        showDeleted: "false",
        maxResults: "50",
        fields: "items(id,recurrence,recurringEventId,iCalUID)",
      },
    });

    const items = r.items ?? [];
    if (items.length === 0)
      return await Promise.reject(new AppError({ code: APP_ERROR.NOT_FOUND, message: "Ассистент: Google Calendar API не нашёл событие по iCalUID" }));

    // Предпочитаем master recurring event (у него есть `recurrence[]`).
    const master = items.find((x) => Array.isArray((x as any).recurrence) && ((x as any).recurrence as any[]).length > 0);
    const id = String((master ?? items[0] ?? {}).id ?? "").trim();
    if (!id) return await Promise.reject(new AppError({ code: APP_ERROR.NOT_FOUND, message: "Ассистент: Google Calendar API вернул событие без id" }));
    return id;
  }

  async patchEventColorId(params: { acc: CaldavAccountConfig; calendarId: string; eventId: string; colorId: string | null }): Promise<void> {
    const token = await this.getAccessToken(params.acc);
    const id = String(params.eventId ?? "").trim();
    if (!id) return;

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.calendarId)}/events/${encodeURIComponent(id)}`;
    await googleJson({
      url,
      method: "PATCH",
      token,
      body: { colorId: params.colorId },
    });
  }

  /**
   * Enrich: подмешать `Event.color` из Google Calendar API.
   * Возвращает события и список label'ов (для меню выбора).
   */
  async enrichEventColors(params: {
    account: CaldavAccountConfig;
    caldavCalendarUrl: string;
    events: Event[];
  }): Promise<{ events: Event[]; labels: Array<{ id: string; name: string; color: string }> }> {
    const calendarId = parseGoogleCalendarIdFromCaldavCalendarUrl(params.caldavCalendarUrl);
    if (!calendarId) return { events: params.events, labels: [] };

    // Диапазон строим от событий (чтобы совпасть с горизонтом провайдера).
    let minMs = Number.POSITIVE_INFINITY;
    let maxMs = 0;
    for (const ev of params.events) {
      const t = ev.start?.getTime?.() ?? NaN;
      if (!Number.isFinite(t)) continue;
      minMs = Math.min(minMs, t);
      maxMs = Math.max(maxMs, t);
    }
    if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || maxMs <= 0) return { events: params.events, labels: [] };

    const timeMinIso = toIso(new Date(minMs - 24 * 60 * 60_000));
    const timeMaxIso = toIso(new Date(maxMs + 24 * 60 * 60_000));

    const [colors, map] = await Promise.all([
      this.getColors(params.account),
      this.listEventColorsInRange({ acc: params.account, calendarId, timeMinIso, timeMaxIso }),
    ]);

    const pal = colors.event ?? {};
    const labels: Array<{ id: string; name: string; color: string }> = [];
    for (const [colorId, v] of Object.entries(pal)) {
      const bg = String(v?.background ?? "").trim();
      if (!bg) continue;
      labels.push({ id: `google:${colorId}`, name: `Google ${colorId} (${bg})`, color: bg });
    }
    labels.sort((a, b) => a.name.localeCompare(b.name, "ru"));

    const outEvents = params.events.map((ev) => {
      const uid = String(ev.id ?? "").trim();
      const colorId = uid ? map.get(uid) : undefined;
      if (!colorId) return ev;
      const bg = String(pal[colorId]?.background ?? "").trim();
      if (!bg) return ev;
      return {
        ...ev,
        color: { id: colorId, name: `Google ${colorId}`, value: bg },
      };
    });

    return { events: outEvents, labels };
  }

  /**
   * Установить цвет встречи через Google Calendar API.
   * payload:
   * - null -> сброс (calendar default)
   * - "google:<id>" -> явный colorId
   * - "#RRGGBB" -> пытаемся найти соответствующий colorId по палитре
   */
  async setEventColorForIcalUid(params: {
    account: CaldavAccountConfig;
    caldavCalendarUrl: string;
    iCalUid: string;
    payload: string | null;
  }): Promise<void> {
    const calendarId = parseGoogleCalendarIdFromCaldavCalendarUrl(params.caldavCalendarUrl);
    if (!calendarId)
      return await Promise.reject(
        new AppError({ code: APP_ERROR.VALIDATION, message: "Ассистент: не удалось определить Google calendarId из calendarUrl" }),
      );

    let colorId: string | null = null;
    if (params.payload == null) {
      colorId = null;
    } else {
      const p = String(params.payload ?? "").trim();
      if (!p) colorId = null;
      else if (p.startsWith("google:")) colorId = p.slice("google:".length).trim() || null;
      else {
        // payload = hex. Ищем совпадение в палитре.
        const colors = await this.getColors(params.account);
        const pal = colors.event ?? {};
        const want = normalizeHex(p);
        const found = Object.entries(pal).find(([, v]) => normalizeHex(String(v?.background ?? "")) === want);
        colorId = found ? String(found[0]) : null;
        if (!colorId) {
          return await Promise.reject(
            new AppError({
              code: APP_ERROR.VALIDATION,
              message: "Ассистент: этот цвет отсутствует в палитре Google (не могу сопоставить colorId)",
              details: { payload: p },
            }),
          );
        }
      }
    }

    const eventId = await this.findMasterGoogleEventIdByIcalUid({ acc: params.account, calendarId, iCalUid: params.iCalUid });
    await this.patchEventColorId({ acc: params.account, calendarId, eventId, colorId });
  }
}

