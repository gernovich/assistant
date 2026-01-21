import { describe, expect, it } from "vitest";
import { renderPersonCard } from "../src/people/personNoteService";
import { renderProjectCard } from "../src/projects/projectNoteService";

describe("card templates", () => {
  it("person card has required frontmatter keys", () => {
    const md = renderPersonCard({ displayName: "Иван Иванов", email: "ivan@example.com" });
    expect(md).toContain("assistant_type: person");
    expect(md).toContain("person_id:");
    expect(md).toContain("display_name:");
    expect(md).toContain("first_name:");
    expect(md).toContain("last_name:");
    expect(md).toContain("middle_name:");
    expect(md).toContain("nick_name:");
    expect(md).toContain("gender:");
    expect(md).toContain("photo:");
    expect(md).toContain("birthday:");
    expect(md).toContain("voiceprint:");
    expect(md).toContain("emails:");
    expect(md).toContain("phones:");
    expect(md).toContain("companies:");
    expect(md).toContain("positions:");
    expect(md).toContain("mailboxes:");
    expect(md).toContain("messengers:");
  });

  it("project card has required frontmatter keys", () => {
    const md = renderProjectCard({ title: "Проект X" });
    expect(md).toContain("assistant_type: project");
    expect(md).toContain("project_id:");
    expect(md).toContain("title:");
    expect(md).toContain("status:");
    expect(md).toContain("owner:");
    expect(md).toContain("protocols:");
    expect(md).toContain("tags:");
  });
});
