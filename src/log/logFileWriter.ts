import type { App, TAbstractFile, TFile, Vault } from "obsidian";
import { normalizePath } from "obsidian";
import type { LogEntry } from "./logService";
import { ensureFolder } from "../vault/ensureFolder";
import { revealOrOpenInNewLeaf } from "../vault/revealOrOpenFile";

export class LogFileWriter {
  private app: App;
  private vault: Vault;
  private folderPath: string;
  private enabled: boolean;
  private flushTimer?: number;
  private pending: LogEntry[] = [];

  constructor(app: App, folderPath: string, enabled: boolean) {
    this.app = app;
    this.vault = app.vault;
    this.folderPath = normalizePath(folderPath);
    this.enabled = enabled;
  }

  setConfig(folderPath: string, enabled: boolean) {
    this.folderPath = normalizePath(folderPath);
    this.enabled = enabled;
  }

  enqueue(entry: LogEntry) {
    if (!this.enabled) return;
    if (!this.folderPath) return;

    this.pending.push(entry);
    if (!this.flushTimer) {
      this.flushTimer = window.setTimeout(() => {
        this.flushTimer = undefined;
        void this.flush();
      }, 500);
    }
  }

  async flush() {
    if (!this.enabled) {
      this.pending = [];
      return;
    }
    const batch = this.pending;
    this.pending = [];
    if (batch.length === 0) return;

    const folder = this.folderPath;
    await ensureFolder(this.vault, folder);

    // group by date (YYYY-MM-DD)
    const byDate = new Map<string, LogEntry[]>();
    for (const e of batch) {
      const d = formatDateYmd(new Date(e.ts));
      const arr = byDate.get(d) ?? [];
      arr.push(e);
      byDate.set(d, arr);
    }

    for (const [ymd, entries] of byDate) {
      const filePath = normalizePath(`${folder}/${ymd}.md`);
      const file = await ensureFile(this.vault, filePath, `## Лог за ${ymd}\n\n`);
      const text = entries.map(formatEntry).join("\n") + "\n";
      await this.vault.append(file, text);
    }
  }

  async openTodayLog() {
    if (!this.folderPath) return;
    const ymd = formatDateYmd(new Date());
    const filePath = normalizePath(`${this.folderPath}/${ymd}.md`);
    await ensureFolder(this.vault, this.folderPath);
    const file = await ensureFile(this.vault, filePath, `## Лог за ${ymd}\n\n`);
    await revealOrOpenInNewLeaf(this.app, file);
  }
}

function formatDateYmd(d: Date): string {
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTimeHms(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function formatEntry(e: LogEntry): string {
  const ts = formatTimeHms(new Date(e.ts));
  const level = e.level.toUpperCase();
  const base = `- ${ts} [${level}] ${e.message}`;
  if (!e.data || Object.keys(e.data).length === 0) return base;
  let json = "";
  try {
    json = JSON.stringify(e.data, null, 2);
  } catch {
    json = String(e.data);
  }
  return `${base}\n\n\`\`\`json\n${json}\n\`\`\`\n`;
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

