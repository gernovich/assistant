import { describe, expect, it } from "vitest";
import { parseFrontmatterMap, splitFrontmatter, stringifyFrontmatterMap, upsertFrontmatter } from "../src/domain/policies/frontmatter";
import { parseMeetingNoteFromMd, parsePersonNoteFromCache, parseProjectNoteFromCache, parseProtocolNoteFromCache } from "../src/domain/policies/frontmatterDtos";
import { isAssistantEntityType } from "../src/domain/policies/frontmatterKeys";

describe("domain/policies/frontmatter", () => {
  it("splitFrontmatter возвращает null, если frontmatter отсутствует", () => {
    const md = "## Заголовок\n\nТекст\n";
    const { frontmatter, body } = splitFrontmatter(md);
    expect(frontmatter).toBeNull();
    expect(body).toBe(md);
  });

  it("splitFrontmatter возвращает null, если блок frontmatter не закрыт", () => {
    const md = ["---", "a: 1", "b: 2", "", "Тело"].join("\n"); // нет закрывающего ---\n
    const { frontmatter, body } = splitFrontmatter(md);
    expect(frontmatter).toBeNull();
    expect(body).toBe(md);
  });

  it("splitFrontmatter корректно отделяет frontmatter и тело", () => {
    const md = ["---", "a: 1", "b: test", "---", "", "## Заголовок", "Тело"].join("\n");
    const { frontmatter, body } = splitFrontmatter(md);
    expect(frontmatter).toBe(["a: 1", "b: test"].join("\n"));
    expect(body).toBe(["", "## Заголовок", "Тело"].join("\n"));
  });

  it("parseFrontmatterMap игнорирует комментарии и пустые строки", () => {
    const fm = ["# comment", "a: 1", "", "b:  test  ", "c:"].join("\n");
    expect(parseFrontmatterMap(fm)).toEqual({ a: "1", b: "test", c: "" });
  });

  it("parseFrontmatterMap игнорирует строки без ключа/двоеточия", () => {
    const fm = ["nope", ": value", " ok: 1 "].join("\n");
    expect(parseFrontmatterMap(fm)).toEqual({ ok: "1" });
  });

  it("isAssistantEntityType распознаёт допустимые значения", () => {
    expect(isAssistantEntityType("calendar_event")).toBe(true);
    expect(isAssistantEntityType("protocol")).toBe(true);
    expect(isAssistantEntityType("person")).toBe(true);
    expect(isAssistantEntityType("project")).toBe(true);
    expect(isAssistantEntityType("x")).toBe(false);
    expect(isAssistantEntityType(null)).toBe(false);
  });

  it("stringifyFrontmatterMap сортирует ключи", () => {
    const s = stringifyFrontmatterMap({ b: "2", a: "1" });
    expect(s).toBe(["a: 1", "b: 2"].join("\n"));
  });

  it("upsertFrontmatter добавляет frontmatter, если его не было", () => {
    const md = "Тело\n";
    const out = upsertFrontmatter(md, { assistant_type: "calendar_event", custom_field: "accepted" });
    expect(out).toContain("assistant_type: calendar_event");
    expect(out).toContain("custom_field: accepted");
    expect(out).toContain("\n---\nТело\n");
  });

  it("upsertFrontmatter удаляет ключи при null/пустой строке", () => {
    const md = ["---", "a: 1", "b: 2", "---", "", "Тело"].join("\n");
    const out = upsertFrontmatter(md, { a: null, b: "" });
    expect(out).not.toContain("\na: ");
    expect(out).not.toContain("\nb: ");
    // `upsertFrontmatter` убирает ведущий перевод строки у body.
    expect(out).toContain("\n---\nТело");
  });

  it("parseMeetingNoteFromMd читает обязательные поля карточки встречи", () => {
    const md = [
      "---",
      "assistant_type: calendar_event",
      "calendar_id: cal-1",
      "event_id: uid-1",
      "summary: Тест",
      "start: 2026-01-20T10:00:00.000Z",
      "end: 2026-01-20T11:00:00.000Z",
      "url: https://example.com",
      "location: Room",
      "status: accepted",
      "---",
      "",
      "# Body",
      "",
    ].join("\n");

    const dto = parseMeetingNoteFromMd(md);
    expect(dto.assistant_type).toBe("calendar_event");
    expect(dto.calendar_id).toBe("cal-1");
    expect(dto.event_id).toBe("uid-1");
    expect(dto.summary).toBe("Тест");
    expect(dto.start).toBe("2026-01-20T10:00:00.000Z");
    expect(dto.end).toBe("2026-01-20T11:00:00.000Z");
    expect(dto.url).toBe("https://example.com");
    expect(dto.location).toBe("Room");
    expect(dto.status).toBe("accepted");
  });

  it("parseMeetingNoteFromMd использует fallback fileBasename для summary, если summary отсутствует", () => {
    const md = [
      "---",
      "assistant_type: calendar_event",
      "calendar_id: cal-1",
      "event_id: uid-1",
      "start: 2026-01-20T10:00:00.000Z",
      "---",
      "",
      "# Body",
    ].join("\n");
    const dto = parseMeetingNoteFromMd(md, { fileBasename: "Базовое имя" });
    expect(dto.summary).toBe("Базовое имя");
  });

  it("parseMeetingNoteFromMd бросает ошибку, если assistant_type не calendar_event", () => {
    const md = ["---", "assistant_type: protocol", "calendar_id: cal-1", "event_id: uid-1", "start: 2026-01-20T10:00:00.000Z", "---"].join("\n");
    expect(() => parseMeetingNoteFromMd(md)).toThrow(/assistant_type/i);
  });

  it("parseProtocolNoteFromCache читает protocol из metadataCache.frontmatter", () => {
    const fm: Record<string, unknown> = {
      assistant_type: "protocol",
      protocol_id: "cal-1:uid-1",
      calendar_id: "cal-1",
      start: "2026-01-20T10:00:00.000Z",
      end: "2026-01-20T11:00:00.000Z",
      summary: "Кратко",
      transcript: "Текст",
      files: ["a.mp3", "b.md"],
      participants: [{ displayName: "Иван", email: "ivan@example.com" }],
      projects: [{ id: "project-1", title: "Проект" }],
    };
    const dto = parseProtocolNoteFromCache(fm);
    expect(dto.assistant_type).toBe("protocol");
    expect(dto.protocol_id).toBe("cal-1:uid-1");
    expect(dto.calendar_id).toBe("cal-1");
    expect(dto.files).toEqual(["a.mp3", "b.md"]);
    expect(dto.participants?.[0]?.email).toBe("ivan@example.com");
  });

  it("parseProtocolNoteFromCache: поддерживает альтернативные поля id/displayName и игнорирует мусорные элементы", () => {
    const fm: Record<string, unknown> = {
      assistant_type: "protocol",
      protocol_id: "cal-1:uid-1",
      calendar_id: "cal-1",
      start: "2026-01-20T10:00:00.000Z",
      // files: массив без строк -> должен стать []
      files: [1, null, { a: 1 }],
      participants: [
        null,
        "x",
        { id: "p-1", displayName: "Иван", email: "ivan@example.com" },
        { person_id: "p-2", display_name: "Пётр" },
        // ветка: без display_name/displayName -> display_name остаётся undefined
        { person_id: "p-3" },
      ],
      projects: [{ project_id: "pr-1", title: "Проект" }, { id: "pr-2", title: "Проект 2" }, 1],
    };
    const dto = parseProtocolNoteFromCache(fm);
    expect(dto.files).toEqual([]);
    expect(dto.participants?.[0]).toEqual({ person_id: "p-1", display_name: "Иван", email: "ivan@example.com" });
    expect(dto.participants?.[1]?.person_id).toBe("p-2");
    expect(dto.participants?.[2]?.person_id).toBe("p-3");
    expect(dto.participants?.[2]?.display_name).toBeUndefined();
    expect(dto.projects?.[0]?.project_id).toBe("pr-1");
    expect(dto.projects?.[1]?.project_id).toBe("pr-2");
  });

  it("parseProtocolNoteFromCache: если participants/projects не массивы, возвращает undefined", () => {
    const fm: Record<string, unknown> = {
      assistant_type: "protocol",
      protocol_id: "cal-1:uid-1",
      calendar_id: "cal-1",
      start: "2026-01-20T10:00:00.000Z",
      participants: "nope",
      projects: { a: 1 },
      files: "x",
    };
    const dto = parseProtocolNoteFromCache(fm);
    expect(dto.participants).toBeUndefined();
    expect(dto.projects).toBeUndefined();
    expect(dto.files).toBeUndefined();
  });

  it("parseProtocolNoteFromCache бросает ошибку при неверном assistant_type", () => {
    const fm: Record<string, unknown> = { assistant_type: "calendar_event" };
    expect(() => parseProtocolNoteFromCache(fm)).toThrow(/assistant_type/i);
  });

  it("parsePersonNoteFromCache читает person из metadataCache.frontmatter", () => {
    const fm: Record<string, unknown> = {
      assistant_type: "person",
      person_id: "person-1",
      display_name: "Иван Иванов",
      emails: ["ivan@example.com", "i.ivanov@corp.com"],
      mailboxes: ["ivan@example.com", "i.ivanov@corp.com"],
      messengers: [{ kind: "telegram", handle: "@ivan" }],
    };
    const dto = parsePersonNoteFromCache(fm);
    expect(dto.assistant_type).toBe("person");
    expect(dto.person_id).toBe("person-1");
    expect(dto.display_name).toBe("Иван Иванов");
    expect(dto.emails).toEqual(["ivan@example.com", "i.ivanov@corp.com"]);
  });

  it("parsePersonNoteFromCache возвращает undefined для emails, если это не массив", () => {
    const fm: Record<string, unknown> = { assistant_type: "person", person_id: "p", emails: "x" };
    const dto = parsePersonNoteFromCache(fm);
    expect(dto.emails).toBeUndefined();
  });

  it("parseProjectNoteFromCache читает project из metadataCache.frontmatter", () => {
    const fm: Record<string, unknown> = {
      assistant_type: "project",
      project_id: "project-1",
      title: "Проект X",
      status: "active",
      owner: { person_id: "person-1", display_name: "Иван", email: "ivan@example.com" },
      tags: ["a", "b"],
      protocols: [{ protocol_id: "cal-1:uid-1", start: "2026-01-20T10:00:00.000Z", summary: "Кратко" }],
    };
    const dto = parseProjectNoteFromCache(fm);
    expect(dto.assistant_type).toBe("project");
    expect(dto.project_id).toBe("project-1");
    expect(dto.title).toBe("Проект X");
    expect(dto.owner?.email).toBe("ivan@example.com");
    expect(dto.tags).toEqual(["a", "b"]);
  });

  it("parseProjectNoteFromCache: owner игнорируется, если это не объект; tags игнорируются, если это не массив строк", () => {
    const fm: Record<string, unknown> = {
      assistant_type: "project",
      project_id: "project-1",
      title: "Проект X",
      owner: ["nope"],
      tags: [1, 2, 3],
    };
    const dto = parseProjectNoteFromCache(fm);
    expect(dto.owner).toBeUndefined();
    expect(dto.tags).toEqual([]);
  });

  it("parseProjectNoteFromCache бросает ошибку, если отсутствует title", () => {
    const fm: Record<string, unknown> = { assistant_type: "project", project_id: "p" };
    expect(() => parseProjectNoteFromCache(fm)).toThrow(/title/i);
  });

  it("parseProjectNoteFromCache бросает ошибку, если отсутствует project_id", () => {
    const fm: Record<string, unknown> = { assistant_type: "project", project_id: "", title: "Проект" };
    expect(() => parseProjectNoteFromCache(fm)).toThrow(/project_id/i);
  });

  it("parseProjectNoteFromCache: owner может быть частичным объектом (не обязателен display_name/email)", () => {
    const fm: Record<string, unknown> = {
      assistant_type: "project",
      project_id: "project-1",
      title: "Проект X",
      owner: { person_id: "person-1" },
    };
    const dto = parseProjectNoteFromCache(fm);
    expect(dto.owner).toEqual({ person_id: "person-1", display_name: undefined, email: undefined });
  });
});
