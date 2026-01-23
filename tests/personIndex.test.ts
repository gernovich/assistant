import { describe, expect, it } from "vitest";
import { PersonIndex } from "../src/people/personIndex";
import type { MetadataCachePort, VaultPort } from "../src/presentation/obsidian/obsidianPorts";
import { FM } from "../src/domain/policies/frontmatterKeys";

type FakeFile = { path: string; basename?: string; stat?: { mtime: number } };

function makeIndex(params: { files: FakeFile[]; fmByPath: Record<string, any> }) {
  const vault: VaultPort = {
    getAbstractFileByPath: () => null,
    createFolder: async () => undefined,
    getMarkdownFiles: () => params.files as unknown[],
    read: async () => "",
    on: () => ({}),
  };
  const metadataCache: MetadataCachePort = {
    getFileCache: (file: any) => ({ frontmatter: params.fmByPath[String(file?.path || "")] }),
  };
  return new PersonIndex({ vault, metadataCache });
}

describe("PersonIndex", () => {
  it("findByEmail: finds card by normalized email inside peopleRoot", () => {
    const idx = makeIndex({
      files: [{ path: "Ассистент/Люди/a.md" }, { path: "Ассистент/Люди/b.md" }, { path: "Ассистент/Проекты/p.md" }],
      fmByPath: {
        "Ассистент/Люди/a.md": { [FM.emails]: ["  Alice@Example.COM  "] },
        "Ассистент/Люди/b.md": { [FM.emails]: ["bob@example.com"] },
        "Ассистент/Проекты/p.md": { [FM.emails]: ["alice@example.com"] },
      },
    });

    const found = idx.findByEmail({ peopleRoot: "Ассистент/Люди", email: "alice@example.com" }) as any;
    expect(found?.path).toBe("Ассистент/Люди/a.md");
  });

  it("listRecent: filters assistant_type=person and sorts by mtime desc", () => {
    const idx = makeIndex({
      files: [
        { path: "Ассистент/Люди/a.md", basename: "a", stat: { mtime: 1 } },
        { path: "Ассистент/Люди/b.md", basename: "b", stat: { mtime: 10 } },
        { path: "Ассистент/Люди/c.md", basename: "c", stat: { mtime: 5 } },
      ],
      fmByPath: {
        "Ассистент/Люди/a.md": { assistant_type: "person" },
        "Ассистент/Люди/b.md": { assistant_type: "person" },
        "Ассистент/Люди/c.md": {}, // missing assistant_type -> keep (backward compatible)
      },
    });

    const out = idx.listRecent({ peopleRoot: "Ассистент/Люди/", limit: 10 });
    expect(out.map((x) => x.path)).toEqual(["Ассистент/Люди/b.md", "Ассистент/Люди/c.md", "Ассистент/Люди/a.md"]);
  });
});
