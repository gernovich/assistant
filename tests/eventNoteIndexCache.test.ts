import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { EventNoteIndexCache } from "../src/calendar/store/eventNoteIndexCache";

describe("calendar/store/eventNoteIndexCache", () => {
  it("save/load сохраняет индекс и загружает только существующие файлы в папке встреч", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "assistant-event-index-"));
    const cachePath = path.join(tmp, "event-index.json");
    const eventsDir = "Ассистент/Встречи";

    // Файлы “внутри” и “снаружи” папки встреч.
    const inFolder = { path: `${eventsDir}/Встреча 1.md`, extension: "md" };
    const outFolder = { path: `Другое/Встреча 2.md`, extension: "md" };
    const notTFile = { path: `${eventsDir}/Папка`, extension: undefined };

    const vault = {
      getAbstractFileByPath: (p: string) => {
        if (p === inFolder.path) return inFolder;
        if (p === outFolder.path) return outFolder;
        if (p === notTFile.path) return notTFile;
        return null;
      },
    } as any;

    const cache = new EventNoteIndexCache({ filePath: cachePath });
    await cache.save({
      eventsDir,
      byEventKey: new Map<string, any>([
        ["cal1:uid1", inFolder],
        ["cal1:uid2", outFolder],
        ["cal1:uid3", notTFile as any], // не TFile — игнор
        ["cal1:uid4", { path: "", extension: "md" } as any], // пустой path — игнор
        ["", inFolder], // пустой ключ — игнор
      ]) as any,
    });

    const loaded = await cache.load(vault, eventsDir);
    expect(loaded.get("cal1:uid1")?.path).toBe(inFolder.path);
    expect(loaded.has("cal1:uid2")).toBe(false);
    expect(loaded.has("cal1:uid3")).toBe(false);
    expect(loaded.has("cal1:uid4")).toBe(false);
  });

  it("load возвращает пустой индекс при несовпадении eventsDir", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "assistant-event-index-"));
    const cachePath = path.join(tmp, "event-index.json");

    const cache = new EventNoteIndexCache({ filePath: cachePath });
    await cache.save({
      eventsDir: "Ассистент/Встречи",
      byEventKey: new Map<string, any>([["k", { path: "Ассистент/Встречи/X.md", extension: "md" }]]) as any,
    });

    const loaded = await cache.load({ getAbstractFileByPath: () => null } as any, "Ассистент/Другое");
    expect(loaded.size).toBe(0);
  });

  it("load возвращает пустой индекс, если filePath пустой", async () => {
    const cache = new EventNoteIndexCache({ filePath: "" });
    const loaded = await cache.load({ getAbstractFileByPath: () => null } as any, "Ассистент/Встречи");
    expect(loaded.size).toBe(0);
  });

  it("load не падает на невалидном JSON (возвращает пустой индекс)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "assistant-event-index-"));
    const cachePath = path.join(tmp, "event-index.json");
    await fs.writeFile(cachePath, "{not-json", "utf8");
    const cache = new EventNoteIndexCache({ filePath: cachePath });
    const loaded = await cache.load({ getAbstractFileByPath: () => null } as any, "Ассистент/Встречи");
    expect(loaded.size).toBe(0);
  });

  it("load возвращает пустой индекс при неверной версии/схеме snapshot", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "assistant-event-index-"));
    const cachePath = path.join(tmp, "event-index.json");
    await fs.writeFile(
      cachePath,
      JSON.stringify({ version: 2, savedAtMs: Date.now(), eventsDir: "Ассистент/Встречи", byEventKey: null }),
      "utf8",
    );
    const cache = new EventNoteIndexCache({ filePath: cachePath });
    const loaded = await cache.load({ getAbstractFileByPath: () => null } as any, "Ассистент/Встречи");
    expect(loaded.size).toBe(0);
  });

  it("load возвращает пустой индекс при битой схеме: eventsDir не строка / savedAtMs не number / byEventKey не object", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "assistant-event-index-"));

    for (const bad of [
      { version: 1, savedAtMs: Date.now(), eventsDir: 123, byEventKey: {} },
      { version: 1, savedAtMs: "x", eventsDir: "Ассистент/Встречи", byEventKey: {} },
      { version: 1, savedAtMs: Date.now(), eventsDir: "Ассистент/Встречи", byEventKey: null },
    ]) {
      const cachePath = path.join(tmp, `event-index-${Math.random()}.json`);
      await fs.writeFile(cachePath, JSON.stringify(bad), "utf8");
      const cache = new EventNoteIndexCache({ filePath: cachePath });
      const loaded = await cache.load({ getAbstractFileByPath: () => null } as any, "Ассистент/Встречи");
      expect(loaded.size).toBe(0);
    }
  });

  it("save не кидает ошибку и пишет warn, если файл нельзя сохранить", async () => {
    const warns: Array<{ m: string; data?: Record<string, unknown> }> = [];
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "assistant-event-index-"));
    const blocker = path.join(tmp, "not-a-dir");
    await fs.writeFile(blocker, "x", "utf8"); // файл, не директория
    const cache = new EventNoteIndexCache({
      filePath: path.join(blocker, "event-index.json"),
      logService: () => ({
        info: () => undefined,
        warn: (m, data) => warns.push({ m, data }),
      }),
    });
    await cache.save({
      eventsDir: "Ассистент/Встречи",
      byEventKey: new Map<string, any>([["k", { path: "Ассистент/Встречи/X.md", extension: "md" }]]) as any,
    });
    expect(warns.some((w) => w.m.includes("не удалось сохранить индекс"))).toBe(true);
  });

  it("save не падает при пустом filePath (early return)", async () => {
    const cache = new EventNoteIndexCache({ filePath: "" });
    await expect(
      cache.save({ eventsDir: "Ассистент/Встречи", byEventKey: new Map<string, any>([["k", { path: "x.md", extension: "md" }]]) as any }),
    ).resolves.toBeUndefined();
  });
});
