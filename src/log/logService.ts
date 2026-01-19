export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  ts: number;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

type Listener = () => void;

export class LogService {
  private maxEntries: number;
  private entries: LogEntry[] = [];
  private listeners = new Set<Listener>();
  private onEntry?: (entry: LogEntry) => void;

  constructor(maxEntries: number, onEntry?: (entry: LogEntry) => void) {
    this.maxEntries = Math.max(10, maxEntries);
    this.onEntry = onEntry;
  }

  setMaxEntries(maxEntries: number) {
    this.maxEntries = Math.max(10, maxEntries);
    this.trim();
    this.emit();
  }

  onChange(cb: Listener) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  list(): LogEntry[] {
    return this.entries.slice();
  }

  info(message: string, data?: Record<string, unknown>) {
    this.push({ ts: Date.now(), level: "info", message, data });
  }

  warn(message: string, data?: Record<string, unknown>) {
    this.push({ ts: Date.now(), level: "warn", message, data });
  }

  error(message: string, data?: Record<string, unknown>) {
    this.push({ ts: Date.now(), level: "error", message, data });
  }

  clear() {
    this.entries = [];
    this.emit();
  }

  private push(e: LogEntry) {
    this.entries.push(e);
    this.trim();
    this.onEntry?.(e);
    this.emit();
  }

  private trim() {
    const overflow = this.entries.length - this.maxEntries;
    if (overflow > 0) this.entries.splice(0, overflow);
  }

  private emit() {
    for (const cb of this.listeners) cb();
  }
}

