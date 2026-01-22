import type { CalendarId, MeetingNoteDto, PersonLinkDto, PersonNoteDto, ProjectLinkDto, ProjectNoteDto, ProtocolNote } from "../../types";
import { parseFrontmatterMap, splitFrontmatter } from "./frontmatter";
import { FM } from "./frontmatterKeys";

/**
 * Policy: типизированные парсеры frontmatter -> DTO.
 *
 * Важно:
 * - `parseFrontmatterMap` читает только плоские `key: value` строки.
 * - Для списков/объектов используем `metadataCache.frontmatter` (Record<string, unknown>).
 */

export function parseMeetingNoteFromMd(md: string, fallback?: { fileBasename?: string }): MeetingNoteDto {
  const { frontmatter } = splitFrontmatter(md);
  const map = frontmatter ? parseFrontmatterMap(frontmatter) : {};

  const type = String(map[FM.assistantType] ?? "").trim();
  if (type !== "calendar_event") {
    throw new Error("Файл не является карточкой встречи (assistant_type != calendar_event)");
  }

  const calendarId = String(map[FM.calendarId] ?? "").trim() as CalendarId;
  const eventId = String(map[FM.eventId] ?? "").trim();
  const summary = String(map[FM.summary] ?? fallback?.fileBasename ?? "Встреча").trim();
  const start = String(map[FM.start] ?? "").trim();
  const end = String(map[FM.end] ?? "").trim();

  if (!calendarId) throw new Error("В карточке встречи отсутствует calendar_id");
  if (!eventId) throw new Error("В карточке встречи отсутствует event_id");
  if (!start) throw new Error("В карточке встречи отсутствует start");

  const url = String(map[FM.url] ?? "").trim();
  const location = String(map[FM.location] ?? "").trim();
  const status = String(map[FM.status] ?? "").trim();
  const organizerEmail = String(map[FM.organizerEmail] ?? "").trim();
  const organizerCn = String(map[FM.organizerCn] ?? "").trim();

  return {
    assistant_type: "calendar_event",
    calendar_id: calendarId,
    event_id: eventId,
    summary,
    start,
    end: end || undefined,
    url: url || undefined,
    location: location || undefined,
    status: (status || undefined) as MeetingNoteDto["status"],
    organizer_email: organizerEmail || undefined,
    organizer_cn: organizerCn || undefined,
  };
}

function readString(fm: Record<string, unknown>, key: string): string | undefined {
  const v = fm[key];
  return typeof v === "string" ? v : undefined;
}

function readStringArray(fm: Record<string, unknown>, key: string): string[] | undefined {
  const v = fm[key];
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x) => typeof x === "string") as string[];
  return out.length ? out : [];
}

function readObject(fm: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = fm[key];
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  return v as Record<string, unknown>;
}

function requireType(fm: Record<string, unknown>, expected: string) {
  const t = readString(fm, FM.assistantType);
  if (t !== expected) throw new Error(`Неверный assistant_type (ожидали ${expected})`);
}

export function parseProtocolNoteFromCache(frontmatter: Record<string, unknown>): ProtocolNote {
  requireType(frontmatter, "protocol");

  const id = String(readString(frontmatter, FM.protocolId) ?? "").trim();
  const calendarId = String(readString(frontmatter, FM.calendarId) ?? "").trim();
  const start = String(readString(frontmatter, FM.start) ?? "").trim();
  const end = String(readString(frontmatter, FM.end) ?? "").trim();

  if (!id) throw new Error("В протоколе отсутствует protocol_id");
  if (!calendarId) throw new Error("В протоколе отсутствует calendar_id");
  if (!start) throw new Error("В протоколе отсутствует start");

  const files = readStringArray(frontmatter, FM.files);
  const participantsRaw = frontmatter[FM.participants];
  const projectsRaw = frontmatter[FM.projects];

  const participants: PersonLinkDto[] | undefined = Array.isArray(participantsRaw)
    ? (participantsRaw as unknown[])
        .filter((x) => x && typeof x === "object" && !Array.isArray(x))
        .map((x) => {
          const o = x as Record<string, unknown>;
          const personId = typeof o.person_id === "string" ? o.person_id : typeof o.id === "string" ? o.id : undefined;
          const displayName =
            typeof o.display_name === "string"
              ? o.display_name
              : typeof (o as any).displayName === "string"
                ? String((o as any).displayName)
                : undefined;
          const email = typeof o.email === "string" ? o.email : undefined;
          return { person_id: personId, display_name: displayName, email };
        })
    : undefined;

  const projects: ProjectLinkDto[] | undefined = Array.isArray(projectsRaw)
    ? (projectsRaw as unknown[])
        .filter((x) => x && typeof x === "object" && !Array.isArray(x))
        .map((x) => {
          const o = x as Record<string, unknown>;
          const projectId = typeof o.project_id === "string" ? o.project_id : typeof o.id === "string" ? o.id : undefined;
          const title = typeof o.title === "string" ? o.title : undefined;
          return { project_id: projectId, title };
        })
    : undefined;

  return {
    assistant_type: "protocol",
    protocol_id: id,
    calendar_id: calendarId as CalendarId,
    start,
    end: end || undefined,
    summary: readString(frontmatter, FM.summary),
    transcript: readString(frontmatter, FM.transcript),
    files,
    participants,
    projects,
  };
}

export function parsePersonNoteFromCache(frontmatter: Record<string, unknown>): PersonNoteDto {
  requireType(frontmatter, "person");
  const id = String(readString(frontmatter, FM.personId) ?? "").trim();
  if (!id) throw new Error("В человеке отсутствует person_id");

  return {
    assistant_type: "person",
    person_id: id,
    display_name: readString(frontmatter, FM.displayName),
    first_name: readString(frontmatter, FM.firstName),
    last_name: readString(frontmatter, FM.lastName),
    middle_name: readString(frontmatter, FM.middleName),
    nick_name: readString(frontmatter, FM.nickName),
    gender: readString(frontmatter, FM.gender),
    photo: readString(frontmatter, FM.photo),
    birthday: readString(frontmatter, FM.birthday),
    voiceprint: readString(frontmatter, FM.voiceprint),
    emails: readStringArray(frontmatter, FM.emails),
    phones: Array.isArray(frontmatter[FM.phones]) ? (frontmatter[FM.phones] as any) : undefined,
    companies: readStringArray(frontmatter, FM.companies),
    positions: readStringArray(frontmatter, FM.positions),
    mailboxes: readStringArray(frontmatter, FM.mailboxes),
    messengers: Array.isArray(frontmatter[FM.messengers]) ? (frontmatter[FM.messengers] as any) : undefined,
  };
}

export function parseProjectNoteFromCache(frontmatter: Record<string, unknown>): ProjectNoteDto {
  requireType(frontmatter, "project");
  const id = String(readString(frontmatter, FM.projectId) ?? "").trim();
  const title = String(readString(frontmatter, "title") ?? "").trim();
  if (!id) throw new Error("В проекте отсутствует project_id");
  if (!title) throw new Error("В проекте отсутствует title");

  const ownerObj = readObject(frontmatter, FM.owner);
  const owner: PersonLinkDto | undefined = ownerObj
    ? {
        person_id: typeof (ownerObj as any).person_id === "string" ? String((ownerObj as any).person_id) : undefined,
        display_name: typeof ownerObj.display_name === "string" ? ownerObj.display_name : undefined,
        email: typeof ownerObj.email === "string" ? ownerObj.email : undefined,
      }
    : undefined;

  return {
    assistant_type: "project",
    project_id: id,
    title,
    status: readString(frontmatter, "status"),
    owner,
    tags: readStringArray(frontmatter, FM.tags),
    protocols: Array.isArray(frontmatter[FM.protocols]) ? (frontmatter[FM.protocols] as any) : undefined,
  };
}

