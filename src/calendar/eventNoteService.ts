import type { App, TAbstractFile, TFile, Vault } from "obsidian";
import { normalizePath } from "obsidian";
import type { CalendarEvent } from "../types";
import { ensureFolder } from "../vault/ensureFolder";
import { revealOrOpenInNewLeaf } from "../vault/revealOrOpenFile";
import { makeEventKey, shortStableId } from "../ids/stableIds";
import { sanitizeFileName } from "../vault/fileNaming";

export class EventNoteService {
  private app: App;
  private vault: Vault;
  private eventsDir: string;

  constructor(app: App, eventsDir: string) {
    this.app = app;
    this.vault = app.vault;
    this.eventsDir = normalizePath(eventsDir);
  }

  setEventsDir(eventsDir: string) {
    this.eventsDir = normalizePath(eventsDir);
  }

  getEventFilePath(ev: CalendarEvent): string {
    // Stable id keeps file stable even if summary changes; summary stays "pretty".
    const eventKey = makeEventKey(ev.calendarId, ev.uid);
    const sid = shortStableId(eventKey, 6);
    const pretty = sanitizeFileName(ev.summary).slice(0, 80);
    return normalizePath(`${this.eventsDir}/${pretty} [${sid}].md`);
  }

  async syncEvents(events: CalendarEvent[]) {
    await ensureFolder(this.vault, this.eventsDir);
    for (const ev of events) {
      await this.upsertEvent(ev);
    }
  }

  async openEvent(ev: CalendarEvent) {
    const filePath = await this.resolveEventFilePath(ev);
    await ensureFolder(this.vault, this.eventsDir);
    const file = await ensureFile(this.vault, filePath, renderEventFile(ev, true));
    await revealOrOpenInNewLeaf(this.app, file);
  }

  async ensureEventFile(ev: CalendarEvent): Promise<TFile> {
    const filePath = await this.resolveEventFilePath(ev);
    await ensureFolder(this.vault, this.eventsDir);
    return await ensureFile(this.vault, filePath, renderEventFile(ev, true));
  }

  async linkProtocol(ev: CalendarEvent, protocolFile: TFile) {
    const evFile = await this.ensureEventFile(ev);
    const cur = await this.vault.read(evFile);
    const linkTarget = protocolFile.path.replace(/\.md$/i, "");
    const link = `- [[${linkTarget}|${protocolFile.basename}]]`;
    const updated = upsertProtocolLink(cur, link);
    if (updated !== cur) await this.vault.modify(evFile, updated);
  }

  async listProtocolFiles(ev: CalendarEvent): Promise<TFile[]> {
    const evFile = await this.ensureEventFile(ev);
    const cur = await this.vault.read(evFile);
    const body = extractProtocolsBody(cur);
    const targets = extractWikiLinkTargets(body);
    const out: TFile[] = [];
    for (const t of targets) {
      const path = t.endsWith(".md") ? t : `${t}.md`;
      const f = this.vault.getAbstractFileByPath(path);
      if (f && isTFile(f)) out.push(f);
    }
    return out;
  }

  async listProtocolInfos(ev: CalendarEvent): Promise<Array<{ file: TFile; start?: Date }>> {
    const files = await this.listProtocolFiles(ev);
    const out: Array<{ file: TFile; start?: Date }> = [];
    for (const f of files) {
      const start = this.getFileFrontmatterDate(f, "start");
      out.push({ file: f, start });
    }
    // Sort latest-first; items without start go last
    out.sort((a, b) => {
      const at = a.start?.getTime();
      const bt = b.start?.getTime();
      if (at == null && bt == null) return 0;
      if (at == null) return 1;
      if (bt == null) return -1;
      return bt - at;
    });
    return out;
  }

  private getFileFrontmatterDate(file: TFile, key: string): Date | undefined {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    const raw = fm ? (fm as Record<string, unknown>)[key] : undefined;
    if (raw instanceof Date) return raw;
    if (typeof raw === "string") {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return undefined;
  }

  async markCancelled(ev: CalendarEvent) {
    const evFile = await this.ensureEventFile(ev);
    const cur = await this.vault.read(evFile);
    const updated = upsertCancelledFlagInUserSection(cur);
    if (updated !== cur) await this.vault.modify(evFile, updated);
  }

  private async upsertEvent(ev: CalendarEvent) {
    const filePath = await this.resolveEventFilePath(ev);
    const existing = this.vault.getAbstractFileByPath(filePath);
    if (existing && isTFile(existing)) {
      const cur = await this.vault.read(existing);
      const updated = mergePreservingSections(cur, renderEventFile(ev, false));
      await this.vault.modify(existing, updated);
      return;
    }
    await ensureFile(this.vault, filePath, renderEventFile(ev, true));
  }

  private async resolveEventFilePath(ev: CalendarEvent): Promise<string> {
    const target = this.getEventFilePath(ev);
    const eventKey = makeEventKey(ev.calendarId, ev.uid);
    const sid = shortStableId(eventKey, 6);

    const existingBySid = this.findEventFileByStableId(sid);
    if (existingBySid && existingBySid.path !== target) {
      // Rename to keep filename pretty when summary changes, but keep stable identity via [sid].
      try {
        await this.vault.rename(existingBySid, target);
        return target;
      } catch {
        // If rename fails (conflict/permissions), fall back to existing path.
        return existingBySid.path;
      }
    }
    return target;
  }

  private findEventFileByStableId(sid: string): TFile | undefined {
    const suffix = ` [${sid}].md`;
    const dirPrefix = normalizePath(this.eventsDir) + "/";
    const files = this.vault.getFiles();
    for (const f of files) {
      if (!f.path.startsWith(dirPrefix)) continue;
      if (f.path.endsWith(suffix)) return f;
    }
    return undefined;
  }
}

function renderEventFile(ev: CalendarEvent, includeUserSections: boolean): string {
  const startIso = ev.start.toISOString();
  const endIso = ev.end ? ev.end.toISOString() : "";
  const eventKey = makeEventKey(ev.calendarId, ev.uid);
  const header = [
    "---",
    `assistant_type: calendar_event`,
    `event_key: ${yamlEscape(eventKey)}`,
    `calendar_id: ${yamlEscape(ev.calendarId)}`,
    `uid: ${yamlEscape(ev.uid)}`,
    `summary: ${yamlEscape(ev.summary)}`,
    `start: ${yamlEscape(startIso)}`,
    `end: ${yamlEscape(endIso)}`,
    ev.url ? `url: ${yamlEscape(ev.url)}` : "",
    ev.location ? `location: ${yamlEscape(ev.location)}` : "",
    "---",
    "",
    `## ${ev.summary}`,
    "",
    `- Начало: ${startIso}`,
    ev.end ? `- Конец: ${endIso}` : "",
    ev.url ? `- Ссылка: ${ev.url}` : "",
    ev.location ? `- Место: ${ev.location}` : "",
    "",
    ev.description ? `## Описание\n\n${ev.description}\n` : "",
    "## Протоколы",
    "<!-- ASSISTANT:PROTOCOLS -->",
  ]
    .filter(Boolean)
    .join("\n");

  const base = header.endsWith("\n") ? header : header + "\n";
  if (!includeUserSections) return base;

  return (
    base +
    [
      "",
      "- (пока пусто)",
      "",
      "## Заметки",
      "",
      "<!-- ASSISTANT:USER -->",
      "",
    ].join("\n")
  );
}

function mergePreservingSections(existing: string, regenerated: string): string {
  // Back-compat: older versions used ASSISTANT:NOTES as the only preserved marker.
  const userMarkerNew = "<!-- ASSISTANT:USER -->";
  const userMarkerOld = "<!-- ASSISTANT:NOTES -->";
  const protocolsMarkerNew = "<!-- ASSISTANT:PROTOCOLS -->";

  // Extract user content
  const userIdxNew = existing.indexOf(userMarkerNew);
  const userIdxOld = existing.indexOf(userMarkerOld);
  const userMarker = userIdxNew !== -1 ? userMarkerNew : userMarkerOld;
  const userIdx = userIdxNew !== -1 ? userIdxNew : userIdxOld;
  const userTail = userIdx === -1 ? "" : existing.slice(userIdx + userMarker.length).trimStart();

  // Extract protocols list (prefer marker, fallback to section heading)
  const protocolsBody = extractProtocolsBody(existing);

  // Apply into regenerated template
  let out = regenerated;

  // Inject protocols body
  const regenProtoIdx = out.indexOf(protocolsMarkerNew);
  if (regenProtoIdx !== -1) {
    const insertAt = regenProtoIdx + protocolsMarkerNew.length;
    const after = out.slice(insertAt);
    const nextSectionIdx = after.search(/\n##\s+/);
    const sliceEnd = nextSectionIdx === -1 ? out.length : insertAt + nextSectionIdx;
    const beforePart = out.slice(0, insertAt);
    const afterPart = out.slice(sliceEnd);
    const body = protocolsBody.trim();
    const normalizedBody = body ? "\n" + body + "\n" : "\n- (пока пусто)\n";
    out = beforePart + normalizedBody + afterPart;
  }

  // Inject user tail
  const regenUserIdx = out.indexOf(userMarkerNew);
  if (regenUserIdx !== -1) {
    const before = out.slice(0, regenUserIdx + userMarkerNew.length);
    const after = out.slice(regenUserIdx + userMarkerNew.length);
    // remove everything after marker in regenerated, replace with preserved
    out = before + "\n" + (userTail ? userTail.trimStart() : "") + "\n";
    // keep a trailing newline
    if (!out.endsWith("\n")) out += "\n";
    // ignore old regenerated tail
    void after;
  }

  return out;
}

function yamlEscape(v: string): string {
  const s = (v ?? "").replace(/\r?\n/g, " ").trim();
  return JSON.stringify(s);
}

function extractProtocolsBody(text: string): string {
  const protocolsMarkerNew = "<!-- ASSISTANT:PROTOCOLS -->";
  const userMarkerNew = "<!-- ASSISTANT:USER -->";
  const userMarkerOld = "<!-- ASSISTANT:NOTES -->";

  const mIdx = text.indexOf(protocolsMarkerNew);
  if (mIdx !== -1) {
    const start = mIdx + protocolsMarkerNew.length;
    const after = text.slice(start);
    const endByUserNew = after.indexOf(userMarkerNew);
    const endByUserOld = after.indexOf(userMarkerOld);
    const endByH2 = after.search(/\n##\s+/);
    const ends = [endByUserNew, endByUserOld, endByH2].filter((x) => x !== -1);
    const end = ends.length === 0 ? after.length : Math.min(...ends);
    return after.slice(0, end).trim();
  }

  // Fallback: parse between heading and next "##"
  const heading = "## Протоколы";
  const hIdx = text.indexOf(heading);
  if (hIdx === -1) return "";
  const afterH = text.slice(hIdx + heading.length);
  const endByNext = afterH.search(/\n##\s+/);
  const body = endByNext === -1 ? afterH : afterH.slice(0, endByNext);
  // remove possible markers
  return body
    .replace(protocolsMarkerNew, "")
    .replace(userMarkerNew, "")
    .replace(userMarkerOld, "")
    .trim();
}

function extractWikiLinkTargets(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/\[\[([^\]]+)\]\]/);
    if (!m) continue;
    const inside = m[1] ?? "";
    const target = inside.split("|")[0]?.trim() ?? "";
    if (target) out.push(target);
  }
  return out;
}

function upsertProtocolLink(text: string, linkLine: string): string {
  if (text.includes(linkLine)) return text;
  const protocolsMarkerNew = "<!-- ASSISTANT:PROTOCOLS -->";
  const idx = text.indexOf(protocolsMarkerNew);

  if (idx === -1) {
    // Fallback: append into (or create) protocols section
    const heading = "## Протоколы";
    const hIdx = text.indexOf(heading);
    if (hIdx === -1) return text + `\n\n${heading}\n${protocolsMarkerNew}\n${linkLine}\n`;
    const insertPos = hIdx + heading.length;
    return text.slice(0, insertPos) + `\n${protocolsMarkerNew}\n${linkLine}\n` + text.slice(insertPos);
  }

  const insertAt = idx + protocolsMarkerNew.length;
  const before = text.slice(0, insertAt);
  const after = text.slice(insertAt);

  // remove placeholder if present at start of meetings body
  const cleanedAfter = after.replace(/^\s*\n- \(пока пусто\)\s*\n/, "\n");
  return before + `\n${linkLine}\n` + cleanedAfter;
}

function upsertCancelledFlagInUserSection(text: string): string {
  const userMarkerNew = "<!-- ASSISTANT:USER -->";
  const userMarkerOld = "<!-- ASSISTANT:NOTES -->";
  const userIdxNew = text.indexOf(userMarkerNew);
  const userIdxOld = text.indexOf(userMarkerOld);
  const marker = userIdxNew !== -1 ? userMarkerNew : userMarkerOld;
  const idx = userIdxNew !== -1 ? userIdxNew : userIdxOld;
  if (idx === -1) return text;

  const head = text.slice(0, idx + marker.length);
  const tail = text.slice(idx + marker.length);
  const line = "- Статус: отменена";
  if (tail.includes(line)) return text;

  return head + "\n" + line + "\n" + tail.trimStart();
}

async function ensureFile(vault: Vault, filePath: string, initial: string): Promise<TFile> {
  const existing = vault.getAbstractFileByPath(filePath);
  if (existing && isTFile(existing)) return existing;
  return await vault.create(filePath, initial);
}

function isTFile(f: TAbstractFile): f is TFile {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (f as any)?.extension != null;
}

