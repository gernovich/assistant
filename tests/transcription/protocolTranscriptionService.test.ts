import { describe, expect, it } from "vitest";
import { ProtocolTranscriptionService } from "../../src/transcription/protocolTranscriptionService";

function makeFakeVaultWithMarkdown() {
  const mdByPath = new Map<string, string>();
  return {
    mdByPath,
    getAbstractFileByPath: (p: string) => {
      if (mdByPath.has(p)) return { path: p, extension: "md", basename: p.split("/").pop()?.replace(/\.md$/i, "") ?? "x" } as any;
      return null;
    },
    read: async (f: any) => mdByPath.get(String(f?.path ?? "")) ?? "",
    modify: async (f: any, next: string) => {
      mdByPath.set(String(f?.path ?? ""), String(next ?? ""));
    },
  };
}

describe("ProtocolTranscriptionService", () => {
  it("помечает файл как расшифрованный в frontmatter transcript и вставляет блок в секцию", async () => {
    const vault = makeFakeVaultWithMarkdown();
    const app = { vault } as any;
    const svc = new ProtocolTranscriptionService(app);

    const protocolPath = "Ассистент/Протоколы/p.md";
    const recPath = "Ассистент/Записи/rec-1.ogg";

    vault.mdByPath.set(
      protocolPath,
      [
        "---",
        "assistant_type: protocol",
        "protocol_id: x",
        "files: []",
        "transcript: []",
        "---",
        "",
        "## P",
        "",
        "### Расшифровка",
        "",
        "- (вставь транскрипт сюда)",
        "",
        "### Саммари",
        "",
        "- ...",
      ].join("\n"),
    );

    await svc.markFileTranscribedAndAppend({
      protocolFilePath: protocolPath,
      recordingFilePath: recPath,
      transcriptMd: "#### Расшифровка: rec-1.ogg\n\n- 00:00.000–00:01.000 привет\n",
    });

    const nextMd = vault.mdByPath.get(protocolPath) ?? "";
    expect(nextMd).toContain(`transcript: ["${recPath}"]`);
    expect(nextMd).toContain("#### Расшифровка: rec-1.ogg");
    expect(nextMd).toContain("00:00.000–00:01.000 привет");

    // повторный вызов не должен дублировать
    await svc.markFileTranscribedAndAppend({
      protocolFilePath: protocolPath,
      recordingFilePath: recPath,
      transcriptMd: "#### Расшифровка: rec-1.ogg\n\n- 00:00.000–00:01.000 привет\n",
    });
    const againMd = vault.mdByPath.get(protocolPath) ?? "";
    expect(againMd.match(/#### Расшифровка: rec-1\.ogg/g)?.length ?? 0).toBe(1);
  });
});

