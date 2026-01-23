import { describe, expect, it } from "vitest";
import { ProtocolAttachmentService } from "../../src/recording/protocolAttachmentService";

function makeFakeVaultWithMarkdown() {
  const mdByPath = new Map<string, string>();
  return {
    mdByPath,
    getAbstractFileByPath: (p: string) => {
      if (mdByPath.has(p)) return ({ path: p, extension: "md", basename: p.split("/").pop()?.replace(/\.md$/i, "") ?? "x" } as any);
      return null;
    },
    read: async (f: any) => mdByPath.get(String(f?.path ?? "")) ?? "",
    modify: async (f: any, next: string) => {
      mdByPath.set(String(f?.path ?? ""), String(next ?? ""));
    },
  };
}

describe("ProtocolAttachmentService", () => {
  it("добавляет путь файла в frontmatter files[] и не дублирует", async () => {
    const vault = makeFakeVaultWithMarkdown();
    const app = { vault } as any;
    const svc = new ProtocolAttachmentService(app);

    const protocolPath = "Ассистент/Протоколы/p.md";
    vault.mdByPath.set(protocolPath, ["---", "assistant_type: protocol", "protocol_id: x", "files: []", "---", "", "## P"].join("\n"));

    await svc.appendRecordingFile(protocolPath, "Ассистент/Записи/rec-1.ogg");
    await svc.appendRecordingFile(protocolPath, "Ассистент/Записи/rec-1.ogg");

    const nextMd = vault.mdByPath.get(protocolPath) ?? "";
    expect(nextMd).toContain('files: ["Ассистент/Записи/rec-1.ogg"]');
  });
});

