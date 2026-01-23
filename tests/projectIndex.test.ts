import { describe, expect, it } from "vitest";
import { ProjectIndex } from "../src/projects/projectIndex";
import type { MetadataCachePort, VaultPort } from "../src/presentation/obsidian/obsidianPorts";

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
  return new ProjectIndex({ vault, metadataCache });
}

describe("ProjectIndex", () => {
  it("listRecent: filters assistant_type=project and sorts by mtime desc", () => {
    const idx = makeIndex({
      files: [
        { path: "Ассистент/Проекты/a.md", basename: "a", stat: { mtime: 1 } },
        { path: "Ассистент/Проекты/b.md", basename: "b", stat: { mtime: 10 } },
        { path: "Ассистент/Проекты/c.md", basename: "c", stat: { mtime: 5 } },
      ],
      fmByPath: {
        "Ассистент/Проекты/a.md": { assistant_type: "project" },
        "Ассистент/Проекты/b.md": { assistant_type: "project" },
        "Ассистент/Проекты/c.md": {}, // missing assistant_type -> keep (backward compatible)
      },
    });

    const out = idx.listRecent({ projectsRoot: "Ассистент/Проекты", limit: 10 });
    expect(out.map((x) => x.path)).toEqual(["Ассистент/Проекты/b.md", "Ассистент/Проекты/c.md", "Ассистент/Проекты/a.md"]);
  });
});
