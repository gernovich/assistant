import { describe, expect, it } from "vitest";
import {
  extractProtocolsBody,
  extractWikiLinkTargets,
  mergePreservingAssistantSections,
  upsertCancelledFlagInUserSection,
  upsertProtocolLink,
} from "../src/domain/policies/assistantMarkdownSections";

describe("domain/policies/assistantMarkdownSections", () => {
  it("mergePreservingAssistantSections сохраняет список протоколов и пользовательский хвост", () => {
    const existing = [
      "---",
      "assistant_type: calendar_event",
      "custom_field: accepted",
      "---",
      "",
      "## Встреча",
      "",
      "## Протоколы",
      "<!-- ASSISTANT:PROTOCOLS -->",
      "- [[Ассистент/Протоколы/P1|P1]]",
      "",
      "## Заметки",
      "<!-- ASSISTANT:USER -->",
      "",
      "- Мои заметки",
      "",
    ].join("\n");

    const regenerated = [
      "---",
      "assistant_type: calendar_event",
      "custom_field: ",
      "---",
      "",
      "## Встреча (regen)",
      "",
      "## Протоколы",
      "<!-- ASSISTANT:PROTOCOLS -->",
      "- (пока пусто)",
      "",
      "## Заметки",
      "<!-- ASSISTANT:USER -->",
      "",
      "- (пока пусто)",
      "",
    ].join("\n");

    const out = mergePreservingAssistantSections(existing, regenerated, { keepFrontmatterKeys: ["custom_field"] });
    expect(out).toContain("custom_field: accepted");
    expect(out).toContain("- [[Ассистент/Протоколы/P1|P1]]");
    expect(out).toContain("- Мои заметки");
    expect(out).not.toContain("- (пока пусто)\n\n## Протоколы"); // не важно, но не должно ломать структуру
  });

  it("mergePreservingAssistantSections умеет вставлять ключ, если его не было в regenerated", () => {
    const existing = ["---", "assistant_type: calendar_event", "custom_field: declined", "---", ""].join("\n");
    const regenerated = [
      "---",
      "assistant_type: calendar_event",
      "---",
      "",
      "<!-- ASSISTANT:PROTOCOLS -->",
      "",
      "<!-- ASSISTANT:USER -->",
      "",
    ].join("\n");
    const out = mergePreservingAssistantSections(existing, regenerated, { keepFrontmatterKeys: ["custom_field"] });
    // ключ должен появиться сразу после assistant_type
    expect(out).toContain("assistant_type: calendar_event\ncustom_field: declined");
  });

  it("mergePreservingAssistantSections корректно работает с legacy маркером ASSISTANT:NOTES", () => {
    const existing = ["## Заметки", "<!-- ASSISTANT:NOTES -->", "", "- legacy"].join("\n");
    const regenerated = ["## Заметки", "<!-- ASSISTANT:USER -->", "", "- (пока пусто)"].join("\n");
    const out = mergePreservingAssistantSections(existing, regenerated);
    expect(out).toContain("- legacy");
  });

  it("extractWikiLinkTargets достаёт targets из wiki-links", () => {
    const text = ["- [[A/B|X]]", "- [[C/D]]", "no link"].join("\n");
    expect(extractWikiLinkTargets(text)).toEqual(["A/B", "C/D"]);
  });

  it("extractWikiLinkTargets игнорирует ссылки с пустым target", () => {
    const text = ["- [[ |alias]]", "- [[X]]"].join("\n");
    expect(extractWikiLinkTargets(text)).toEqual(["X"]);
  });

  it("extractProtocolsBody работает по marker", () => {
    const md = ["## Протоколы", "<!-- ASSISTANT:PROTOCOLS -->", "- [[X]]", "## Дальше"].join("\n");
    expect(extractProtocolsBody(md)).toBe("- [[X]]");
  });

  it("extractProtocolsBody по marker: если дальше нет маркеров/секций, берёт до конца файла", () => {
    const md = ["## Протоколы", "<!-- ASSISTANT:PROTOCOLS -->", "- [[X]]", "- [[Y]]"].join("\n");
    expect(extractProtocolsBody(md)).toBe("- [[X]]\n- [[Y]]");
  });

  it("extractProtocolsBody работает без marker (fallback по заголовку)", () => {
    const md = ["## Протоколы", "", "- [[X]]", "", "## Дальше"].join("\n");
    expect(extractProtocolsBody(md)).toBe("- [[X]]");
  });

  it("extractProtocolsBody возвращает пусто, если секции нет", () => {
    expect(extractProtocolsBody("## Встреча\n")).toBe("");
  });

  it("upsertProtocolLink добавляет ссылку и не дублирует её", () => {
    const md = ["## Протоколы", "<!-- ASSISTANT:PROTOCOLS -->", "- (пока пусто)", ""].join("\n");
    const link = "- [[Ассистент/Протоколы/P1|P1]]";
    const out1 = upsertProtocolLink(md, link);
    expect(out1).toContain(link);
    expect(out1).not.toContain("- (пока пусто)");
    const out2 = upsertProtocolLink(out1, link);
    expect(out2).toBe(out1);
  });

  it("upsertProtocolLink: если placeholder отсутствует, просто вставляет строку", () => {
    const md = ["## Протоколы", "<!-- ASSISTANT:PROTOCOLS -->", "- [[Y]]", ""].join("\n");
    const out = upsertProtocolLink(md, "- [[X]]");
    expect(out).toContain("- [[X]]");
    expect(out).toContain("- [[Y]]");
  });

  it("upsertProtocolLink fallback: если marker нет, вставляет его после заголовка", () => {
    const md = ["## Протоколы", "", "- (пока пусто)", "", "## Дальше"].join("\n");
    const link = "- [[X]]";
    const out = upsertProtocolLink(md, link);
    expect(out).toContain("<!-- ASSISTANT:PROTOCOLS -->");
    expect(out).toContain(link);
  });

  it("upsertProtocolLink fallback: если секции нет, создаёт её в конце", () => {
    const md = ["## Встреча", "текст"].join("\n");
    const link = "- [[X]]";
    const out = upsertProtocolLink(md, link);
    expect(out).toContain("## Протоколы");
    expect(out).toContain("<!-- ASSISTANT:PROTOCOLS -->");
    expect(out).toContain(link);
  });

  it("upsertCancelledFlagInUserSection добавляет флаг отмены в user секцию", () => {
    const md = ["## Заметки", "<!-- ASSISTANT:USER -->", "", "- x"].join("\n");
    const out = upsertCancelledFlagInUserSection(md);
    expect(out).toContain("- Статус: отменена");
    // второй раз не добавляет дубль
    expect(upsertCancelledFlagInUserSection(out)).toBe(out);
  });

  it("upsertCancelledFlagInUserSection не меняет текст, если маркера нет", () => {
    const md = "## Заметки\n- x\n";
    expect(upsertCancelledFlagInUserSection(md)).toBe(md);
  });

  it("upsertCancelledFlagInUserSection поддерживает legacy ASSISTANT:NOTES", () => {
    const md = ["## Заметки", "<!-- ASSISTANT:NOTES -->", "", "- x"].join("\n");
    expect(upsertCancelledFlagInUserSection(md)).toContain("- Статус: отменена");
  });

  it("mergePreservingAssistantSections не падает, если в regenerated нет маркеров", () => {
    const existing = [
      "---",
      "assistant_type: calendar_event",
      "custom_field: accepted",
      "---",
      "",
      "<!-- ASSISTANT:NOTES -->",
      "- x",
    ].join("\n");
    const regenerated = ["---", "assistant_type: calendar_event", "---", "", "body"].join("\n");
    const out = mergePreservingAssistantSections(existing, regenerated, { keepFrontmatterKeys: ["custom_field"] });
    expect(out).toContain("custom_field: accepted");
  });

  it("mergePreservingAssistantSections не перетирает непустое значение в regenerated", () => {
    const existing = ["---", "assistant_type: calendar_event", "custom_field: accepted", "---", ""].join("\n");
    const regenerated = ["---", "assistant_type: calendar_event", "custom_field: tentative", "---", ""].join("\n");
    const out = mergePreservingAssistantSections(existing, regenerated, { keepFrontmatterKeys: ["custom_field"] });
    expect(out).toContain("custom_field: tentative");
    expect(out).not.toContain("custom_field: accepted");
  });

  it("mergePreservingAssistantSections возвращает regenerated, если existing/regenerated без frontmatter", () => {
    const existing = "нет frontmatter\n";
    const regenerated = "тоже нет frontmatter\n";
    expect(mergePreservingAssistantSections(existing, regenerated, { keepFrontmatterKeys: ["custom_field"] })).toBe(regenerated);
  });

  it("mergePreservingAssistantSections возвращает regenerated, если ключей сохранять не удалось (changed=false)", () => {
    const existing = ["---", "assistant_type: calendar_event", "---", ""].join("\n");
    const regenerated = ["---", "assistant_type: calendar_event", "---", ""].join("\n");
    expect(mergePreservingAssistantSections(existing, regenerated, { keepFrontmatterKeys: ["custom_field"] })).toBe(regenerated);
  });
});
