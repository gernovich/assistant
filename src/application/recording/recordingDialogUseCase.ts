import type { AssistantSettings, Event } from "../../types";
import { makeEventKey } from "../../ids/stableIds";
import { pickDefaultRecordingTarget } from "../../recording/recordingTarget";
import { err, ok, type Result } from "../../shared/result";

export type RecordingDialogLike = { open: () => void };

type Logger = {
  info: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

export type RecordingDialogUseCaseDeps = {
  getSettings: () => AssistantSettings;
  getEvents: () => Event[];
  getRecordingsProtocolsList: (limit: number) => Array<{ path: string; label: string }>;

  warnLinuxNativeDepsOnOpen: () => void;

  createProtocolFromEvent: (ev: Event) => Promise<string>; // returns protocol file path
  createEmptyProtocolAndOpen: () => Promise<string>; // returns protocol file path
  openProtocolByPath: (protocolFilePath: string) => Promise<void>;

  dialogFactory: (params: {
    settings: AssistantSettings;
    events: Event[];
    protocols: Array<{ path: string; label: string }>;
    defaultEventKey?: string;
    lockDefaultEvent?: boolean;
    defaultCreateNewProtocol: boolean;
    onCreateProtocol: (ev: Event) => Promise<string | null | undefined>;
    onCreateEmptyProtocol: () => Promise<string | null | undefined>;
    onOpenProtocol: (protocolFilePath: string) => Promise<void>;
    onLog: (m: string) => void;
  }) => RecordingDialogLike;

  notice: (message: string) => void;
  log: Logger;
  now: () => Date;
};

export class RecordingDialogUseCase {
  private lastOpen?: { atMs: number; eventKey: string };

  constructor(private readonly deps: RecordingDialogUseCaseDeps) {}

  openResult(preferredEvent?: Event): Result<{ opened: boolean; skipped: boolean }> {
    // Ранний фидбек: если выбран Linux Native и не хватает зависимостей — покажем Notice сразу при открытии окна.
    // Если всё ок — молчим.
    this.deps.warnLinuxNativeDepsOnOpen();

    const settings = this.deps.getSettings();
    const events = this.deps.getEvents();

    const preferredKey = preferredEvent ? makeEventKey(preferredEvent.calendar.id, preferredEvent.id) : undefined;

    // Guard: не открываем окно повторно “в спам” (например если таймер/клик сработали одновременно).
    const key = String(preferredKey ?? "");
    const nowMs = this.deps.now().getTime();
    if (this.lastOpen && this.lastOpen.eventKey === key && nowMs - this.lastOpen.atMs < 30_000) {
      return ok({ opened: false, skipped: true });
    }
    this.lastOpen = { atMs: nowMs, eventKey: key };

    const picked = preferredKey
      ? { selectedEventKey: preferredKey, createNewProtocol: true }
      : pickDefaultRecordingTarget(events, this.deps.now(), 5);

    const dlg = this.deps.dialogFactory({
      settings,
      events,
      protocols: this.deps.getRecordingsProtocolsList(120),
      defaultEventKey: picked.selectedEventKey,
      lockDefaultEvent: Boolean(preferredKey),
      // По умолчанию всегда создаём протокол (встречный или пустой), чтобы запись не терялась без контекста.
      defaultCreateNewProtocol: true,
      onCreateProtocol: async (ev) => {
        try {
          return await this.deps.createProtocolFromEvent(ev);
        } catch {
          return null;
        }
      },
      onCreateEmptyProtocol: async () => {
        try {
          return await this.deps.createEmptyProtocolAndOpen();
        } catch {
          return null;
        }
      },
      onOpenProtocol: async (p) => {
        await this.deps.openProtocolByPath(String(p || ""));
      },
      onLog: (m) => this.deps.log.info(m),
    });

    try {
      dlg.open();
      return ok({ opened: true, skipped: false });
    } catch (e) {
      const msg = String((e as unknown) ?? "неизвестная ошибка");
      const code = msg.includes("BrowserWindow") ? "E_ELECTRON_UNAVAILABLE" : "E_INTERNAL";
      return err({
        code,
        message: "Ассистент: не удалось открыть диалог записи",
        cause: msg,
      });
    }
  }

  /** Backward-compat API: не бросает исключения и сохраняет UX (notice + лог). */
  open(preferredEvent?: Event): void {
    const r = this.openResult(preferredEvent);
    if (!r.ok) {
      this.deps.log.error("Запись: не удалось открыть диалог", { code: r.error.code, error: r.error.cause });
      this.deps.notice(r.error.message);
    }
  }
}
