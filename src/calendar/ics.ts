import type { CalendarEvent, CalendarId } from "../types";

// Minimal ICS (VEVENT) parser for MVP.
// Supported fields: UID, DTSTART, DTEND, SUMMARY, DESCRIPTION, LOCATION, URL, RRULE, EXDATE, ATTENDEE(PARTSTAT)

export function parseIcs(
  calendarId: CalendarId,
  icsText: string,
  opts?: {
    now?: Date;
    horizonDays?: number;
    myEmail?: string;
  },
): CalendarEvent[] {
  const lines = unfoldLines(icsText);
  const events: CalendarEvent[] = [];

  let inEvent = false;
  let cur: ParsedVEvent = createEmptyEvent();

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      cur = createEmptyEvent();
      continue;
    }
    if (line === "END:VEVENT") {
      if (inEvent) {
        const evs = toEvents(calendarId, cur, opts);
        events.push(...evs);
      }
      inEvent = false;
      cur = createEmptyEvent();
      continue;
    }
    if (!inEvent) continue;

    const cl = parseContentLine(line);
    if (!cl) continue;
    applyContentLine(cur, cl);
  }

  return events;
}

type ContentLine = {
  name: string;
  params: Record<string, string>;
  value: string;
};

type ParsedVEvent = {
  single: Partial<Record<string, string>>;
  rrule?: string;
  exdates: string[]; // raw values (may contain comma-separated list)
  attendees: Array<{ value: string; params: Record<string, string> }>;
};

function createEmptyEvent(): ParsedVEvent {
  return { single: {}, exdates: [], attendees: [] };
}

function parseContentLine(line: string): ContentLine | null {
  const idx = line.indexOf(":");
  if (idx <= 0) return null;
  const left = line.slice(0, idx);
  const value = line.slice(idx + 1);

  const parts = left.split(";");
  const name = (parts[0] ?? "").toUpperCase();
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
  // Keep first occurrence for scalar fields
  if (ev.single[key] == null) ev.single[key] = cl.value;
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

function toEvents(calendarId: CalendarId, ve: ParsedVEvent, opts?: { now?: Date; horizonDays?: number; myEmail?: string }): CalendarEvent[] {
  const base = toBaseEvent(calendarId, ve, opts?.myEmail);
  if (!base) return [];
  if (!ve.rrule) return [base];

  const now = opts?.now ?? new Date();
  const horizonDays = Math.max(1, opts?.horizonDays ?? 60);
  const horizonEnd = new Date(now.getTime() + horizonDays * 24 * 60 * 60_000);

  const ex = parseExdates(ve.exdates);
  return expandRrule(base, ve.rrule, ex, horizonEnd);
}

function toBaseEvent(calendarId: CalendarId, ve: ParsedVEvent, myEmail?: string): CalendarEvent | null {
  const fields = ve.single;
  const uid = fields.UID?.trim();
  const dtStartRaw = fields.DTSTART?.trim();
  const summary = (fields.SUMMARY ?? "").trim() || "(без названия)";
  if (!uid || !dtStartRaw) return null;

  const start = parseIcsDate(dtStartRaw);
  if (!start) return null;

  const dtEndRaw = fields.DTEND?.trim();
  const end = dtEndRaw ? parseIcsDate(dtEndRaw) ?? undefined : undefined;

  const allDay = isAllDay(dtStartRaw);

  const myPartstat = detectMyPartstat(ve.attendees, myEmail);

  return {
    calendarId,
    uid,
    summary: unescapeText(summary),
    description: fields.DESCRIPTION ? unescapeText(fields.DESCRIPTION) : undefined,
    location: fields.LOCATION ? unescapeText(fields.LOCATION) : undefined,
    url: fields.URL ? fields.URL.trim() : undefined,
    start,
    end,
    allDay,
    myPartstat,
  };
}

function normalizeEmail(v: string): string {
  const s = (v ?? "").trim();
  const m = s.match(/^mailto:(.+)$/i);
  return (m ? m[1] : s).trim().toLowerCase();
}

function detectMyPartstat(
  attendees: Array<{ value: string; params: Record<string, string> }>,
  myEmail?: string,
): CalendarEvent["myPartstat"] | undefined {
  const me = normalizeEmail(myEmail ?? "");
  if (!me) return undefined;
  for (const a of attendees) {
    const email = normalizeEmail(a.value);
    if (!email || email !== me) continue;
    const ps = String(a.params["PARTSTAT"] ?? "").toUpperCase();
    if (ps === "ACCEPTED") return "accepted";
    if (ps === "DECLINED") return "declined";
    if (ps === "TENTATIVE") return "tentative";
    if (ps === "NEEDS-ACTION") return "needs_action";
    return undefined;
  }
  return undefined;
}

function isAllDay(v: string): boolean {
  // VALUE=DATE normally appears in params, but MVP strips params. We use heuristic:
  // YYYYMMDD (8 chars) -> all-day
  return /^\d{8}$/.test(v);
}

function parseIcsDate(v: string): Date | null {
  // Supported:
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

function unescapeText(s: string): string {
  return s
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
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
  for (const chunk of (rrule ?? "").split(";")) {
    const idx = chunk.indexOf("=");
    if (idx <= 0) continue;
    const k = chunk.slice(0, idx).toUpperCase().trim();
    const v = chunk.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function expandRrule(base: CalendarEvent, rrule: string, exdateMs: number[], horizonEnd: Date): CalendarEvent[] {
  const rule = parseRrule(rrule);
  const freq = String(rule["FREQ"] ?? "").toUpperCase();
  const interval = Math.max(1, Number(rule["INTERVAL"] ?? 1) || 1);
  const countLimit = Math.max(0, Number(rule["COUNT"] ?? 0) || 0);
  const until = rule["UNTIL"] ? parseIcsDate(rule["UNTIL"]) ?? undefined : undefined;
  const hardEnd = until && until < horizonEnd ? until : horizonEnd;

  const durationMs =
    base.end != null
      ? base.end.getTime() - base.start.getTime()
      : base.allDay
        ? 24 * 60 * 60_000
        : 0;

  const ex = new Set<number>(exdateMs);

  const out: CalendarEvent[] = [];
  const addOcc = (start: Date) => {
    const sMs = start.getTime();
    if (sMs > hardEnd.getTime()) return;
    if (ex.has(sMs)) return;
    const end = durationMs > 0 ? new Date(sMs + durationMs) : undefined;
    out.push({ ...base, start: new Date(sMs), end });
  };

  // Always include the base DTSTART occurrence if it's within horizon
  addOcc(base.start);

  // Guard: no freq -> return base only
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

  // WEEKLY
  const bydayRaw = rule["BYDAY"];
  const bydays = bydayRaw ? bydayRaw.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) : [];
  const targetDays = bydays.length > 0 ? bydays : [weekdayToByday(base.start.getDay())];

  // Iterate day-by-day within horizon (cheap for <= 60d), filter by week interval and day-of-week.
  const startDay = startOfDay(base.start);
  const endDay = startOfDay(hardEnd);
  for (let d = new Date(startDay.getTime()); d.getTime() <= endDay.getTime() && generated < maxGen; d = addDays(d, 1)) {
    const diffDays = Math.floor((d.getTime() - startDay.getTime()) / (24 * 60 * 60_000));
    const weekIndex = Math.floor(diffDays / 7);
    if (weekIndex % interval !== 0) continue;
    const by = weekdayToByday(d.getDay());
    if (!targetDays.includes(by)) continue;

    // Apply time-of-day from DTSTART
    const occ = new Date(d.getTime());
    occ.setHours(base.start.getHours(), base.start.getMinutes(), base.start.getSeconds(), base.start.getMilliseconds());
    // Skip base occurrence (already added)
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
  // JS: 0=Sun..6=Sat
  if (jsDay === 1) return "MO";
  if (jsDay === 2) return "TU";
  if (jsDay === 3) return "WE";
  if (jsDay === 4) return "TH";
  if (jsDay === 5) return "FR";
  if (jsDay === 6) return "SA";
  return "SU";
}
