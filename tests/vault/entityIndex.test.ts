import { describe, expect, test } from "vitest";

import { EntityIndex } from "../../src/vault/entityIndex";

type FakeFile = { path: string; basename?: string; stat?: { mtime?: number } };

function makeIndex(params: {
  files?: FakeFile[];
  frontmattersByPath: Record<string, unknown | undefined>;
  readByPath?: Record<string, string>;
  readThrows?: Set<string>;
}) {
  const vault = {
    getAbstractFileByPath: (_path: string) => null,
    createFolder: async (_path: string) => null,
    getMarkdownFiles: () => params.files as any,
    read: async (file: FakeFile) => {
      const p = file.path;
      if (params.readThrows?.has(p)) throw new Error("read failed");
      return params.readByPath?.[p] ?? "";
    },
    on: (_eventName: "modify", _cb: (file: any) => void) => ({ off: () => {} }),
  };

  const metadataCache = {
    getFileCache: (file: FakeFile) => {
      const fm = params.frontmattersByPath[file.path];
      return fm === undefined ? null : { frontmatter: fm };
    },
  };

  return new EntityIndex({ vault, metadataCache });
}

describe("EntityIndex", () => {
  test("listRecentByType uses default limit=50 when limit=0", () => {
    const files: FakeFile[] = [];
    const fm: Record<string, unknown> = { assistant_type: "protocol" };
    const frontmattersByPath: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) {
      const p = `Root/Protocols/p${i}.md`;
      files.push({ path: p, basename: `p${i}`, stat: { mtime: i } });
      frontmattersByPath[p] = fm;
    }

    const idx = makeIndex({ files, frontmattersByPath });
    const out = idx.listRecentByType({ root: "Root/Protocols", limit: 0, assistantType: "protocol" });
    expect(out).toHaveLength(50);
  });

  test("listRecentByType tolerates vault.getMarkdownFiles() returning undefined", () => {
    const idx = makeIndex({ files: undefined, frontmattersByPath: {} });
    const out = idx.listRecentByType({ root: "Root/Protocols", limit: 10, assistantType: "protocol" });
    expect(out).toEqual([]);
  });

  test("listRecentByType can return files with missing path when root is empty (path fallback branch)", () => {
    const idx = makeIndex({
      files: [{ path: undefined as any, basename: undefined, stat: undefined }],
      frontmattersByPath: { "": { assistant_type: "protocol" } },
    });

    const out = idx.listRecentByType({ root: "", limit: 10, assistantType: "protocol" });
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe("");
    expect(out[0].label).toBe("");
  });

  test("listRecentByType sorts files with missing mtime as 0 (mtime??0 branch)", () => {
    const idx = makeIndex({
      files: [
        { path: "Root/Protocols/p1.md", basename: "p1", stat: undefined },
        { path: "Root/Protocols/p2.md", basename: "p2", stat: { mtime: 10 } },
      ],
      frontmattersByPath: {
        "Root/Protocols/p1.md": { assistant_type: "protocol" },
        "Root/Protocols/p2.md": { assistant_type: "protocol" },
      },
    });

    const out = idx.listRecentByType({ root: "Root/Protocols", limit: 10, assistantType: "protocol" });
    expect(out.map((x) => x.path)).toEqual(["Root/Protocols/p2.md", "Root/Protocols/p1.md"]);
  });
  test("listRecentByType filters by folder and assistant_type; missing assistant_type allowed by default", () => {
    const idx = makeIndex({
      files: [
        { path: "Root/Protocols/p1.md", basename: "p1", stat: { mtime: 1 } },
        { path: "Root/Protocols/p2.md", basename: "p2", stat: { mtime: 10 } },
        { path: "Root/People/u1.md", basename: "u1", stat: { mtime: 100 } },
        { path: "Other/p3.md", basename: "p3", stat: { mtime: 1000 } },
      ],
      frontmattersByPath: {
        "Root/Protocols/p1.md": { assistant_type: "protocol" },
        // p2: missing assistant_type
        "Root/Protocols/p2.md": {},
        "Root/People/u1.md": { assistant_type: "person" },
        "Other/p3.md": { assistant_type: "protocol" },
      },
    });

    const out = idx.listRecentByType({ root: "Root/Protocols", limit: 10, assistantType: "protocol" });
    // p2 included because allowMissingAssistantType defaults to true; sorted by mtime desc.
    expect(out.map((x) => x.path)).toEqual(["Root/Protocols/p2.md", "Root/Protocols/p1.md"]);
  });

  test("listRecentByType with empty root lists from vault root (normalizeDirPrefix empty-branch)", () => {
    const idx = makeIndex({
      files: [
        { path: "A/p1.md", basename: "p1", stat: { mtime: 1 } },
        { path: "B/p2.md", basename: "p2", stat: { mtime: 2 } },
      ],
      frontmattersByPath: {
        "A/p1.md": { assistant_type: "protocol" },
        "B/p2.md": { assistant_type: "protocol" },
      },
    });

    const out = idx.listRecentByType({ root: "", limit: 10, assistantType: "protocol" });
    expect(out.map((x) => x.path)).toEqual(["B/p2.md", "A/p1.md"]);
  });

  test("listRecentByType can exclude files with missing assistant_type", () => {
    const idx = makeIndex({
      files: [{ path: "Root/Protocols/p2.md", stat: { mtime: 1 } }],
      frontmattersByPath: { "Root/Protocols/p2.md": {} },
    });

    const out = idx.listRecentByType({
      root: "Root/Protocols",
      limit: 10,
      assistantType: "protocol",
      allowMissingAssistantType: false,
    });
    expect(out).toEqual([]);
  });

  test("listRecentByType label uses basenameFromPath fallback when basename missing", () => {
    const idx = makeIndex({
      files: [{ path: "Root/Protocols/p3.md", stat: { mtime: 1 } }],
      frontmattersByPath: { "Root/Protocols/p3.md": { assistant_type: "protocol" } },
    });

    const out = idx.listRecentByType({ root: "Root/Protocols", limit: 1, assistantType: "protocol" });
    expect(out[0].label).toBe("p3");
  });

  test("listRecentByType label fallback keeps non-.md file name (basenameFromPath else-branch)", () => {
    const idx = makeIndex({
      files: [{ path: "Root/Protocols/p3.txt", stat: { mtime: 1 } }],
      frontmattersByPath: { "Root/Protocols/p3.txt": { assistant_type: "protocol" } },
    });

    const out = idx.listRecentByType({ root: "Root/Protocols", limit: 1, assistantType: "protocol" });
    expect(out[0].label).toBe("p3.txt");
  });

  test("readStringArrayFromCache supports array and json-string array; otherwise empty", () => {
    const idx = makeIndex({
      files: [],
      frontmattersByPath: {
        "f1.md": { emails: ["a@x", 1, "b@x"] },
        "f2.md": { files: '["p1","p2"]' },
        "f3.md": { files: 123 },
        "f4.md": { files: "not-json-array" },
      },
    });

    expect(idx.readStringArrayFromCache({ path: "f1.md" }, "emails")).toEqual(["a@x", "b@x"]);
    expect(idx.readStringArrayFromCache({ path: "f2.md" }, "files")).toEqual(["p1", "p2"]);
    expect(idx.readStringArrayFromCache({ path: "f3.md" }, "files")).toEqual([]);
    expect(idx.readStringArrayFromCache({ path: "f4.md" }, "files")).toEqual([]);
    expect(idx.readStringArrayFromCache({ path: "missing.md" }, "files")).toEqual([]);
  });

  test("readAssistantTypeFromMd reads assistant_type from YAML frontmatter; returns empty on errors", async () => {
    const idx = makeIndex({
      files: [],
      frontmattersByPath: {},
      readByPath: {
        "ok.md": ["---", "assistant_type: protocol", "---", "", "body"].join("\n"),
        "no-type.md": ["---", "foo: bar", "---", "", "body"].join("\n"),
        "no-fm.md": "body",
      },
      readThrows: new Set(["err.md"]),
    });

    await expect(idx.readAssistantTypeFromMd({ path: "ok.md" })).resolves.toBe("protocol");
    await expect(idx.readAssistantTypeFromMd({ path: "no-type.md" })).resolves.toBe("");
    await expect(idx.readAssistantTypeFromMd({ path: "no-fm.md" })).resolves.toBe("");
    await expect(idx.readAssistantTypeFromMd({ path: "err.md" })).resolves.toBe("");
  });

  test("readJsonStringArrayFromMd reads json-string array from YAML; returns [] on missing or errors", async () => {
    const idx = makeIndex({
      files: [],
      frontmattersByPath: {},
      readByPath: {
        "ok.md": ["---", 'emails: ["a@x","b@x"]', "---", "", "body"].join("\n"),
        "not-array.md": ["---", "emails: a@x", "---", "", "body"].join("\n"),
        "missing.md": ["---", "assistant_type: person", "---"].join("\n"),
      },
      readThrows: new Set(["err.md"]),
    });

    await expect(idx.readJsonStringArrayFromMd({ path: "ok.md" }, "emails")).resolves.toEqual(["a@x", "b@x"]);
    await expect(idx.readJsonStringArrayFromMd({ path: "not-array.md" }, "emails")).resolves.toEqual([]);
    await expect(idx.readJsonStringArrayFromMd({ path: "missing.md" }, "emails")).resolves.toEqual([]);
    await expect(idx.readJsonStringArrayFromMd({ path: "err.md" }, "emails")).resolves.toEqual([]);
  });
});
