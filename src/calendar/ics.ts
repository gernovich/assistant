import type { Calendar, Event, EventColor, EventReminderDto, EventRecurrenceDto, Person } from "../types";
import { normalizeEmail } from "../domain/policies/normalizeEmail";

// Минимальный ICS (VEVENT) парсер для MVP.
// Поддерживаемые поля: UID, DTSTART, DTEND, SUMMARY, DESCRIPTION, LOCATION, URL, RRULE, EXDATE, ATTENDEE(PARTSTAT)

/**
 * Распарсить текст `.ics` в список событий.
 *
 * Важно: это MVP-парсер, покрывающий базовый набор полей и простые RRULE (в пределах горизонта).
 */
export function parseIcs(
  calendar: Calendar,
  icsText: string,
  opts?: {
    now?: Date;
    horizonDays?: number;
    myEmail?: string;
  },
): Event[] {
  const lines = unfoldLines(icsText);
  const vevents: ParsedVEvent[] = [];

  let inEvent = false;
  let inAlarm = false;
  let alarmCur: { trigger?: string; action?: string; description?: string } | null = null;
  let cur: ParsedVEvent = createEmptyEvent();

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      inAlarm = false;
      alarmCur = null;
      cur = createEmptyEvent();
      continue;
    }
    if (line === "END:VEVENT") {
      if (inEvent) {
        // Если VALARM не был корректно закрыт — просто сбрасываем.
        inAlarm = false;
        alarmCur = null;
        vevents.push(cur);
      }
      inEvent = false;
      cur = createEmptyEvent();
      continue;
    }
    if (!inEvent) continue;

    // VALARM внутри VEVENT
    if (line === "BEGIN:VALARM") {
      inAlarm = true;
      alarmCur = {};
      continue;
    }
    if (line === "END:VALARM") {
      if (inAlarm && alarmCur) cur.reminders.push(alarmCur);
      inAlarm = false;
      alarmCur = null;
      continue;
    }

    const cl = parseContentLine(line);
    if (!cl) continue;

    if (inAlarm && alarmCur) {
      if (cl.name === "TRIGGER") alarmCur.trigger = cl.value.trim();
      else if (cl.name === "ACTION") alarmCur.action = cl.value.trim();
      else if (cl.name === "DESCRIPTION") alarmCur.description = cl.value.trim();
      continue;
    }
    applyContentLine(cur, cl);
  }

  // Two-pass: CalDAV/ICS может содержать master (RRULE) и отдельные overrides (RECURRENCE-ID).
  // Если не исключить overrides, получим дубли одного и того же occurrence в повестке.
  const overridesByUidStart = new Map<string, Set<number>>();
  for (const ve of vevents) {
    const uid = (ve.single.UID ?? "").trim();
    const dtStartRaw = (ve.single.DTSTART ?? "").trim();
    const recurrenceRaw = (ve.single["RECURRENCE-ID"] ?? "").trim();
    if (!uid || !dtStartRaw || !recurrenceRaw) continue;
    const start = parseIcsDate(dtStartRaw);
    if (!start) continue;
    let set = overridesByUidStart.get(uid);
    if (!set) {
      set = new Set<number>();
      overridesByUidStart.set(uid, set);
    }
    set.add(start.getTime());
  }

  const out: Event[] = [];
  for (const ve of vevents) {
    const uid = (ve.single.UID ?? "").trim();
    const blocked = uid ? overridesByUidStart.get(uid) : undefined;
    out.push(...toEvents(calendar, ve, opts, blocked));
  }

  // Финальная страховка от дублей (на случай кривого фида):
  // дедуп по (calendar.id, event.id, startMs) с приоритетом “более богатых” полей.
  const byKey = new Map<string, { ev: Event; score: number }>();
  for (const ev of out) {
    const key = `${ev.calendar.id}:${ev.id}:${ev.start.getTime()}`;
    const score =
      (ev.attendees?.length ? 4 : 0) +
      (ev.status ? 2 : 0) +
      (ev.location ? 1 : 0) +
      (ev.url ? 1 : 0) +
      (ev.description ? 1 : 0);
    const prev = byKey.get(key);
    if (!prev || score >= prev.score) byKey.set(key, { ev, score });
  }
  return Array.from(byKey.values()).map((x) => x.ev);
}

type ContentLine = {
  name: string;
  params: Record<string, string>;
  value: string;
};

type ParsedVEvent = {
  single: Partial<Record<string, string>>;
  singleParams: Partial<Record<string, Record<string, string>>>;
  rrule?: string;
  exdates: string[]; // сырой текст (может содержать список через запятую)
  attendees: Array<{ value: string; params: Record<string, string> }>;
  organizer?: { value: string; params: Record<string, string> };
  reminders: Array<{ trigger?: string; action?: string; description?: string }>;
};

function createEmptyEvent(): ParsedVEvent {
  return { single: {}, singleParams: {}, exdates: [], attendees: [], reminders: [] };
}

function parseContentLine(line: string): ContentLine | null {
  const idx = line.indexOf(":");
  if (idx <= 0) return null;
  const left = line.slice(0, idx);
  const value = line.slice(idx + 1);

  const parts = left.split(";");
  // `split(";")` всегда возвращает хотя бы один элемент, поэтому `parts[0]` не бывает `undefined`.
  const name = parts[0].toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    const eq = p.indexOf("=");
    if (eq <= 0) continue;
    const k = p.slice(0, eq).toUpperCase();
    const v = p.slice(eq + 1).replace(/^"|"$/g, "");
    if (k) params[k] = v;
  }
  return { name, params, value };
}

function applyContentLine(ev: ParsedVEvent, cl: ContentLine) {
  const key = cl.name;
  if (key === "RRULE") {
    ev.rrule = cl.value.trim();
    return;
  }
  if (key === "EXDATE") {
    ev.exdates.push(cl.value.trim());
    return;
  }
  if (key === "ATTENDEE") {
    ev.attendees.push({ value: cl.value.trim(), params: cl.params });
    return;
  }
  if (key === "ORGANIZER") {
    // Берём первый ORGANIZER (в норме он один).
    if (!ev.organizer) ev.organizer = { value: cl.value.trim(), params: cl.params };
    return;
  }
  // Для скалярных полей сохраняем первое значение + params (TZID/VALUE и т.п.)
  if (ev.single[key] == null) {
    ev.single[key] = cl.value;
    ev.singleParams[key] = cl.params;
  }
}

function unfoldLines(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if (!line) continue;
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function toEvents(
  calendar: Calendar,
  ve: ParsedVEvent,
  opts?: { now?: Date; horizonDays?: number; myEmail?: string },
  blockedStartMs?: Set<number>,
): Event[] {
  const base = toBaseEvent(calendar, ve, opts?.myEmail);
  if (!base) return [];
  if (!ve.rrule) return [base];

  const now = opts?.now ?? new Date();
  const horizonDays = Math.max(1, opts?.horizonDays ?? 60);
  const horizonEnd = new Date(now.getTime() + horizonDays * 24 * 60 * 60_000);

  const ex = parseExdates(ve.exdates);
  return expandRrule(base, ve.rrule, ex, horizonEnd, blockedStartMs);
}

function toBaseEvent(calendar: Calendar, ve: ParsedVEvent, myEmail?: string): Event | null {
  const fields = ve.single;
  const uid = fields.UID?.trim();
  const dtStartRaw = fields.DTSTART?.trim();
  const summary = (fields.SUMMARY ?? "").trim() || "(без названия)";
  if (!uid || !dtStartRaw) return null;

  const start = parseIcsDate(dtStartRaw);
  if (!start) return null;

  const dtEndRaw = fields.DTEND?.trim();
  const end = dtEndRaw ? (parseIcsDate(dtEndRaw) ?? undefined) : undefined;

  const dtStartParams = ve.singleParams.DTSTART;
  const dtEndParams = ve.singleParams.DTEND;
  const allDay = isAllDay(dtStartRaw, dtStartParams);

  const timeZone = detectTimeZone(dtStartRaw, dtStartParams, dtEndParams);

  const status = detectMyPartstat(ve.attendees, myEmail);
  const attendees = parseAttendees(ve.attendees);
  const organizer = parseOrganizer(ve.organizer);
  const recurrence = buildRecurrence(ve);
  const reminders = buildReminders(ve, myEmail);
  const color = parseEventColor(fields, ve.singleParams);
  const calendarColor = typeof (calendar.config as any)?.color === "string" ? String((calendar.config as any).color).trim() : "";

  return {
    calendar,
    id: uid,
    summary: unescapeText(summary),
    description: fields.DESCRIPTION ? unescapeText(fields.DESCRIPTION) : undefined,
    location: fields.LOCATION ? unescapeText(fields.LOCATION) : undefined,
    url: fields.URL ? fields.URL.trim() : undefined,
    start,
    end,
    timeZone,
    allDay,
    status,
    recurrence,
    reminders,
    color: color ?? (calendarColor ? { value: calendarColor } : undefined),
    organizer,
    attendees,
  };
}

function detectMyPartstat(
  attendees: Array<{ value: string; params: Record<string, string> }>,
  myEmail?: string,
): Event["status"] | undefined {
  const raw = String(myEmail ?? "").trim();
  if (!raw) return undefined;
  // Поддерживаем несколько email: "a@b, c@d" / "a@b c@d" / "a@b;c@d"
  const meSet = new Set(
    raw
      .split(/[,\s;]+/g)
      .map((x) => normalizeEmail(x))
      .filter(Boolean),
  );
  if (meSet.size === 0) return undefined;
  for (const a of attendees) {
    const email = normalizeEmail(a.value);
    if (!email || !meSet.has(email)) continue;
    const ps = String(a.params["PARTSTAT"] ?? "").toUpperCase();
    if (ps === "ACCEPTED") return "accepted";
    if (ps === "DECLINED") return "declined";
    if (ps === "TENTATIVE") return "tentative";
    if (ps === "NEEDS-ACTION") return "needs_action";
    return undefined;
  }
  return undefined;
}

function parseAttendees(attendees: Array<{ value: string; params: Record<string, string> }>): Event["attendees"] {
  const out: NonNullable<Event["attendees"]> = [];
  const seen = new Set<string>();
  for (const a of attendees) {
    const email = normalizeEmail(a.value);
    if (!email) continue;
    if (seen.has(email)) continue;
    seen.add(email);

    const cnRaw = String(a.params["CN"] ?? "").trim();
    const partstatRaw = String(a.params["PARTSTAT"] ?? "").trim();
    const roleRaw = String(a.params["ROLE"] ?? "").trim();

    out.push({
      email,
      cn: cnRaw ? cnRaw : undefined,
      partstat: partstatRaw ? partstatRaw : undefined,
      role: roleRaw ? roleRaw : undefined,
    });
  }
  return out.length ? out : undefined;
}

function parseOrganizer(org?: { value: string; params: Record<string, string> }): Event["organizer"] | undefined {
  if (!org) return undefined;
  const email = normalizeEmail(org.value);
  if (!email) return undefined;
  const cnRaw = String(org.params?.CN ?? "").trim();
  const displayName = cnRaw ? cnRaw : undefined;
  // email уже проверен выше, поэтому ветвление здесь не нужно.
  const p: Person = { displayName, emails: [email], mailboxes: [email] };
  return p;
}

function isAllDay(v: string, params?: Record<string, string>): boolean {
  // VALUE=DATE -> “весь день”, иначе fallback на эвристику YYYYMMDD.
  if (String(params?.VALUE ?? "").toUpperCase() === "DATE") return true;
  return /^\d{8}$/.test(v);
}

function parseIcsDate(v: string): Date | null {
  // Поддерживаем:
  // - YYYYMMDD
  // - YYYYMMDDTHHMMSSZ
  // - YYYYMMDDTHHMMSS
  // - YYYYMMDDTHHMMZ / YYYYMMDDTHHMM
  if (/^\d{8}$/.test(v)) {
    const y = Number(v.slice(0, 4));
    const m = Number(v.slice(4, 6)) - 1;
    const d = Number(v.slice(6, 8));
    return new Date(y, m, d, 0, 0, 0, 0);
  }

  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const hh = Number(m[4]);
  const mm = Number(m[5]);
  const ss = m[6] ? Number(m[6]) : 0;
  const isUtc = Boolean(m[7]);

  return isUtc ? new Date(Date.UTC(y, mo, d, hh, mm, ss, 0)) : new Date(y, mo, d, hh, mm, ss, 0);
}

function detectTimeZone(
  dtStartRaw: string,
  dtStartParams?: Record<string, string>,
  dtEndParams?: Record<string, string>,
): string | undefined {
  const tzid = String(dtStartParams?.TZID ?? dtEndParams?.TZID ?? "").trim();
  if (tzid) return tzid;
  // DTSTART/DTEND с суффиксом Z -> UTC
  if (/[zZ]$/.test(dtStartRaw)) return "UTC";
  return undefined;
}

function buildRecurrence(ve: ParsedVEvent): EventRecurrenceDto | undefined {
  const recurrenceId = String(ve.single["RECURRENCE-ID"] ?? "").trim();
  const rrule = String(ve.rrule ?? "").trim();
  const exdates = ve.exdates.length ? ve.exdates.slice() : [];
  if (!recurrenceId && !rrule && exdates.length === 0) return undefined;
  return {
    recurrenceId: recurrenceId ? recurrenceId : undefined,
    rrule: rrule ? rrule : undefined,
    exdates: exdates.length ? exdates : undefined,
  };
}

function buildReminders(ve: ParsedVEvent, myEmail?: string): Event["reminders"] | undefined {
  if (!ve.reminders.length) return undefined;
  const email = String(myEmail ?? "")
    .trim()
    .split(/[,\s;]+/g)
    .map((x) => normalizeEmail(x))
    .filter(Boolean)[0];
  const person: Person = email ? { emails: [email], mailboxes: [email] } : {};
  return ve.reminders.map((r) => ({
    trigger: r.trigger,
    minutesBefore: r.trigger ? parseTriggerMinutesBefore(r.trigger) : undefined,
    action: r.action,
    description: r.description,
    status: "planned",
    person,
  }));
}

function parseTriggerMinutesBefore(trigger: string): number | undefined {
  // `trigger` приходит строкой из VALARM; дополнительное `?? ""` лишь добавляет мёртвую ветку.
  const t = String(trigger).trim();
  // Пример: -PT5M, -PT15M, -PT1H
  const m = t.match(/^-(?:P)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!m) return undefined;
  const hh = m[1] ? Number(m[1]) : 0;
  const mm = m[2] ? Number(m[2]) : 0;
  const ss = m[3] ? Number(m[3]) : 0;
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss)) return undefined;
  const totalMin = hh * 60 + mm + (ss > 0 ? 1 : 0);
  return totalMin > 0 ? totalMin : undefined;
}

function parseEventColor(fields: Partial<Record<string, string>>, params: Partial<Record<string, Record<string, string>>>): EventColor | undefined {
  // RFC 7986: COLOR:#RRGGBB
  const c = String(fields.COLOR ?? "").trim();
  if (!c) return undefined;
  return { id: c, value: c };
}

function unescapeText(s: string): string {
  return s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function parseExdates(exdates: string[]): number[] {
  const out: number[] = [];
  for (const raw of exdates) {
    for (const part of raw.split(",")) {
      const d = parseIcsDate(part.trim());
      if (d) out.push(d.getTime());
    }
  }
  return out;
}

function parseRrule(rrule: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const chunk of rrule.split(";")) {
    const idx = chunk.indexOf("=");
    if (idx <= 0) continue;
    const k = chunk.slice(0, idx).toUpperCase().trim();
    const v = chunk.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function expandRrule(
  base: Event,
  rrule: string,
  exdateMs: number[],
  horizonEnd: Date,
  blockedStartMs?: Set<number>,
): Event[] {
  const rule = parseRrule(rrule);
  const freq = String(rule["FREQ"] ?? "").toUpperCase();
  const interval = Math.max(1, Number(rule["INTERVAL"] ?? 1) || 1);
  const countLimit = Math.max(0, Number(rule["COUNT"] ?? 0) || 0);
  const until = rule["UNTIL"] ? (parseIcsDate(rule["UNTIL"]) ?? undefined) : undefined;
  const hardEnd = until && until < horizonEnd ? until : horizonEnd;

  const durationMs = base.end != null ? base.end.getTime() - base.start.getTime() : base.allDay ? 24 * 60 * 60_000 : 0;

  const ex = new Set<number>(exdateMs);

  const out: Event[] = [];
  const addOcc = (start: Date) => {
    const sMs = start.getTime();
    if (sMs > hardEnd.getTime()) return;
    if (ex.has(sMs)) return;
    // Если в фиде есть override VEVENT для этого occurrence — не создаём дубликат из RRULE.
    // Override будет добавлен отдельным VEVENT без RRULE (см. blockedStartMs).
    if (blockedStartMs && blockedStartMs.has(sMs)) return;
    const end = durationMs > 0 ? new Date(sMs + durationMs) : undefined;
    out.push({ ...base, start: new Date(sMs), end });
  };

  // Всегда добавляем базовое DTSTART-происхождение (если оно в горизонте).
  addOcc(base.start);

  // Защита: нет FREQ -> возвращаем только базовое событие.
  if (freq !== "DAILY" && freq !== "WEEKLY") return out;

  const maxGen = 2000;
  let generated = 1;

  if (freq === "DAILY") {
    let cur = new Date(base.start.getTime());
    while (generated < maxGen) {
      cur = addDays(cur, interval);
      if (cur.getTime() > hardEnd.getTime()) break;
      addOcc(cur);
      generated++;
      if (countLimit > 0 && out.length >= countLimit) break;
    }
    return out;
  }

  // Режим WEEKLY
  const bydayRaw = rule["BYDAY"];
  const bydays = bydayRaw
    ? bydayRaw
        .split(",")
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean)
    : [];
  const targetDays = bydays.length > 0 ? bydays : [weekdayToByday(base.start.getDay())];

  // Идём по дням в пределах горизонта (дёшево для <= 60 дней), фильтруем по interval и дню недели.
  const startDay = startOfDay(base.start);
  const endDay = startOfDay(hardEnd);
  for (let d = new Date(startDay.getTime()); d.getTime() <= endDay.getTime() && generated < maxGen; d = addDays(d, 1)) {
    const diffDays = Math.floor((d.getTime() - startDay.getTime()) / (24 * 60 * 60_000));
    const weekIndex = Math.floor(diffDays / 7);
    if (weekIndex % interval !== 0) continue;
    const by = weekdayToByday(d.getDay());
    if (!targetDays.includes(by)) continue;

    // Применяем время суток из DTSTART.
    const occ = new Date(d.getTime());
    occ.setHours(base.start.getHours(), base.start.getMinutes(), base.start.getSeconds(), base.start.getMilliseconds());
    // Пропускаем базовое происхождение (оно уже добавлено).
    if (occ.getTime() === base.start.getTime()) continue;
    addOcc(occ);
    generated++;
    if (countLimit > 0 && out.length >= countLimit) break;
  }

  return out;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + days);
  return out;
}

function startOfDay(d: Date): Date {
  const out = new Date(d.getTime());
  out.setHours(0, 0, 0, 0);
  return out;
}

function weekdayToByday(jsDay: number): string {
  // JS: 0=Вс..6=Сб
  if (jsDay === 1) return "MO";
  if (jsDay === 2) return "TU";
  if (jsDay === 3) return "WE";
  if (jsDay === 4) return "TH";
  if (jsDay === 5) return "FR";
  if (jsDay === 6) return "SA";
  return "SU";
}
