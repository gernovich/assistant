import { describe, expect, it } from "vitest";
import { ProtocolIndex } from "../src/protocols/protocolIndex";
import type { MetadataCachePort, VaultPort } from "../src/presentation/obsidian/obsidianPorts";

type FakeFile = {
  path: string;
  basename?: string;
  stat?: { mtime: number };
};

function makeIndex(params: { files: FakeFile[]; fmByPath: Record<string, any> }) {
  const vault: VaultPort = {
    getAbstractFileByPath: () => null,
    createFolder: async () => undefined,
    getMarkdownFiles: () => params.files as unknown[],
    read: async () => "",
    on: () => ({}),
  };
  const metadataCache: MetadataCachePort = {
    getFileCache: (file: any) => {
      const fm = params.fmByPath[String(file?.path || "")];
      return fm ? { frontmatter: fm } : { frontmatter: undefined };
    },
  };
  return new ProtocolIndex({ vault, metadataCache });
}

describe("ProtocolIndex", () => {
  it("filters by protocolsRoot, assistant_type protocol (or missing), sorts by mtime desc and applies limit", () => {
    const idx = makeIndex({
      files: [
        { path: "Ассистент/Протоколы/p1.md", basename: "p1", stat: { mtime: 10 } },
        { path: "Ассистент/Протоколы/p2.md", basename: "p2", stat: { mtime: 30 } },
        { path: "Ассистент/Протоколы/not-protocol.md", basename: "not-protocol", stat: { mtime: 50 } },
        { path: "Ассистент/Встречи/m1.md", basename: "m1", stat: { mtime: 999 } },
      ],
      fmByPath: {
        // missing assistant_type -> keep (backward compatible)
        "Ассистент/Протоколы/p1.md": {},
        "Ассистент/Протоколы/p2.md": { assistant_type: "protocol" },
        "Ассистент/Протоколы/not-protocol.md": { assistant_type: "calendar_event" },
      },
    });

    const out = idx.listRecent({ protocolsRoot: "Ассистент/Протоколы", limit: 1 });
    expect(out).toEqual([{ path: "Ассистент/Протоколы/p2.md", label: "p2" }]);
  });

  it("label falls back to basename from path if basename is absent", () => {
    const idx = makeIndex({
      files: [{ path: "Ассистент/Протоколы/a.md", stat: { mtime: 1 } }],
      fmByPath: { "Ассистент/Протоколы/a.md": { assistant_type: "protocol" } },
    });
    const out = idx.listRecent({ protocolsRoot: "Ассистент/Протоколы/", limit: 10 });
    expect(out[0]?.label).toBe("a");
  });
});

