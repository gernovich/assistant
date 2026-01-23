export type RecordingStatus = "idle" | "recording" | "paused";

export type RecordingStats = {
  status: RecordingStatus;
  startedAtMs?: number;
  elapsedMs?: number;
  filesTotal: number;
  filesRecognized: number;
  foundProjects?: number;
  foundFacts?: number;
  foundPeople?: number;
  nextChunkInMs?: number;
  eventKey?: string;
  protocolFilePath?: string;
};

export type RecordingBackendId = "electron_media_devices" | "linux_native";

export type RecordingBackendSessionHandle = { kind: RecordingBackendId };

export type RecordingBackend = {
  startSession(params: {
    recordingsDir: string;
    filePrefix: string;
    mimeTypePref?: string;
    eventKey?: string;
    onFileSaved: (path: string) => void;
  }): Promise<RecordingBackendSessionHandle>;
  startNewChunk(handle: RecordingBackendSessionHandle): Promise<void>;
  finalizeCurrentFile(handle: RecordingBackendSessionHandle): Promise<void>;
  stopSession(handle: RecordingBackendSessionHandle): Promise<void>;
  setPaused?: (handle: RecordingBackendSessionHandle, paused: boolean) => void;
};

export type RecordingUseCaseDeps = {
  nowMs: () => number;
  setInterval: (cb: () => void, ms: number) => number;
  clearInterval: (id: number) => void;

  shouldRotateChunk: (params: { nowMs: number; lastChunkAtMs: number; chunkEveryMs: number }) => boolean;
  nextChunkInMs: (params: { nowMs: number; lastChunkAtMs: number; chunkEveryMs: number }) => number;

  ensureRecordingsDir: (dir: string) => Promise<void>;

  /**
   * Vault-операции прикрепления файлов к протоколу (через узкий адаптер/сервис).
   * Это НЕ ответственность backend'а записи.
   */
  appendRecordingFileToProtocol?: (protocolFilePath: string, recordingFilePath: string) => Promise<void>;

  backends: Record<RecordingBackendId, RecordingBackend>;
};

type Session = {
  backend: RecordingBackendId;
  status: "recording" | "paused";
  startedAtMs: number;
  currentFileStartedAtMs: number;
  recordingsDir: string;
  filePrefix: string;
  mimeTypePref?: string;
  eventKey?: string;
  protocolFilePath?: string;

  chunkEveryMs: number;
  lastChunkAtMs: number;
  chunkTimer?: number;
  rotateChain?: Promise<void>;
  stopping?: boolean;

  filesTotal: number;
  filesRecognized: number;
  foundProjects: number;
  foundFacts: number;
  foundPeople: number;

  handle: RecordingBackendSessionHandle;

  pendingProtocolWrites: Set<Promise<void>>;
};

export class RecordingUseCase {
  private session: Session | null = null;
  private onStats?: (s: RecordingStats) => void;

  constructor(private deps: RecordingUseCaseDeps) {}

  setOnStats(cb?: (s: RecordingStats) => void) {
    this.onStats = cb;
  }

  getStats(): RecordingStats {
    if (!this.session) return { status: "idle", filesTotal: 0, filesRecognized: 0 };
    const now = this.deps.nowMs();
    const nextChunkInMs =
      this.session.status === "recording"
        ? this.deps.nextChunkInMs({ nowMs: now, lastChunkAtMs: this.session.lastChunkAtMs, chunkEveryMs: this.session.chunkEveryMs })
        : undefined;
    return {
      status: this.session.status === "paused" ? "paused" : "recording",
      startedAtMs: this.session.startedAtMs,
      elapsedMs: Math.max(0, now - this.session.startedAtMs),
      filesTotal: this.session.filesTotal,
      filesRecognized: this.session.filesRecognized,
      foundProjects: this.session.foundProjects,
      foundFacts: this.session.foundFacts,
      foundPeople: this.session.foundPeople,
      nextChunkInMs,
      eventKey: this.session.eventKey,
      protocolFilePath: this.session.protocolFilePath,
    };
  }

  updateProcessingStats(stats: { filesRecognized?: number; foundProjects?: number; foundFacts?: number; foundPeople?: number }): void {
    const s = this.session;
    if (!s) return;
    if (typeof stats.filesRecognized === "number" && Number.isFinite(stats.filesRecognized))
      s.filesRecognized = Math.max(0, Math.floor(stats.filesRecognized));
    if (typeof stats.foundProjects === "number" && Number.isFinite(stats.foundProjects))
      s.foundProjects = Math.max(0, Math.floor(stats.foundProjects));
    if (typeof stats.foundFacts === "number" && Number.isFinite(stats.foundFacts)) s.foundFacts = Math.max(0, Math.floor(stats.foundFacts));
    if (typeof stats.foundPeople === "number" && Number.isFinite(stats.foundPeople))
      s.foundPeople = Math.max(0, Math.floor(stats.foundPeople));
    this.onStats?.(this.getStats());
  }

  async start(params: {
    backend: RecordingBackendId;
    recordingsDir: string;
    filePrefix: string;
    mimeTypePref?: string;
    chunkEveryMs: number;
    eventKey?: string;
    protocolFilePath?: string;
  }): Promise<void> {
    if (this.session) return;

    const startedAtMs = this.deps.nowMs();
    const backend = this.deps.backends[params.backend];

    // Важно: папка для записей должна существовать до старта backend'а,
    // иначе быстрый dataavailable может попытаться сохранить файл раньше createFolder().
    await this.deps.ensureRecordingsDir(params.recordingsDir);

    const handle = await backend.startSession({
      recordingsDir: params.recordingsDir,
      filePrefix: params.filePrefix,
      mimeTypePref: params.mimeTypePref,
      eventKey: params.eventKey,
      onFileSaved: (recordingFilePath) => {
        const s = this.session;
        if (!s) return;
        s.filesTotal += 1;
        this.onStats?.(this.getStats());

        const protocolFilePath = String(s.protocolFilePath ?? "");
        if (!protocolFilePath || !this.deps.appendRecordingFileToProtocol) return;
        const p = this.deps.appendRecordingFileToProtocol(protocolFilePath, String(recordingFilePath || ""));
        s.pendingProtocolWrites.add(p);
        void p.finally(() => s.pendingProtocolWrites.delete(p));
      },
    });

    const session: Session = {
      backend: params.backend,
      status: "recording",
      startedAtMs,
      currentFileStartedAtMs: startedAtMs,
      recordingsDir: params.recordingsDir,
      filePrefix: params.filePrefix,
      mimeTypePref: params.mimeTypePref,
      eventKey: params.eventKey,
      protocolFilePath: params.protocolFilePath,
      chunkEveryMs: params.chunkEveryMs,
      lastChunkAtMs: startedAtMs,
      filesTotal: 0,
      filesRecognized: 0,
      foundProjects: 0,
      foundFacts: 0,
      foundPeople: 0,
      handle,
      pendingProtocolWrites: new Set(),
    };

    this.session = session;

    session.chunkTimer = this.deps.setInterval(() => {
      const s = this.session;
      if (!s || s !== session) return;
      if (s.stopping) return;
      if (s.status !== "recording") return;
      const now = this.deps.nowMs();
      if (!this.deps.shouldRotateChunk({ nowMs: now, lastChunkAtMs: s.lastChunkAtMs, chunkEveryMs: s.chunkEveryMs })) return;
      void this.rotateChunk(session, now);
    }, 1000);

    this.onStats?.(this.getStats());
  }

  private async rotateChunk(session: Session, atMs: number): Promise<void> {
    session.rotateChain = (session.rotateChain ?? Promise.resolve()).then(async () => {
      if (!this.session || this.session !== session) return;
      if (session.stopping) return;
      if (session.status !== "recording") return;

      session.lastChunkAtMs = atMs;
      await this.finalizeCurrentFile(session);
      if (!this.session || this.session !== session) return;
      if (session.stopping) return;
      if (session.status !== "recording") return;

      await this.deps.backends[session.backend].startNewChunk(session.handle);
      this.onStats?.(this.getStats());
    });
    await session.rotateChain;
  }

  private async finalizeCurrentFile(session: Session): Promise<void> {
    await this.deps.backends[session.backend].finalizeCurrentFile(session.handle);
  }

  async pause(): Promise<void> {
    const s = this.session;
    if (!s) return;
    if (s.status === "paused") return;
    s.status = "paused";
    try {
      this.deps.backends[s.backend].setPaused?.(s.handle, true);
    } catch {
      // ignore
    }
    try {
      if (s.chunkTimer) this.deps.clearInterval(s.chunkTimer);
    } catch {
      // ignore
    }
    s.chunkTimer = undefined;
    s.lastChunkAtMs = this.deps.nowMs();
    await this.finalizeCurrentFile(s);
    await Promise.allSettled(Array.from(s.pendingProtocolWrites));
    this.onStats?.(this.getStats());
  }

  async resume(): Promise<void> {
    const s = this.session;
    if (!s) return;
    if (s.status !== "paused") return;
    await this.deps.backends[s.backend].startNewChunk(s.handle);
    s.status = "recording";
    s.lastChunkAtMs = this.deps.nowMs();
    s.currentFileStartedAtMs = s.lastChunkAtMs;
    try {
      this.deps.backends[s.backend].setPaused?.(s.handle, false);
    } catch {
      // ignore
    }
    s.chunkTimer = this.deps.setInterval(() => {
      if (!this.session || this.session !== s) return;
      if (s.stopping) return;
      if (s.status !== "recording") return;
      const now = this.deps.nowMs();
      if (!this.deps.shouldRotateChunk({ nowMs: now, lastChunkAtMs: s.lastChunkAtMs, chunkEveryMs: s.chunkEveryMs })) return;
      void this.rotateChunk(s, now);
    }, 1000);
    this.onStats?.(this.getStats());
  }

  async stop(): Promise<void> {
    const s = this.session;
    if (!s) return;
    s.stopping = true;
    let firstErr: unknown = null;
    try {
      try {
        if (s.chunkTimer) this.deps.clearInterval(s.chunkTimer);
      } catch {
        // ignore
      }
      s.chunkTimer = undefined;

      s.lastChunkAtMs = this.deps.nowMs();

      try {
        await this.finalizeCurrentFile(s);
      } catch (e) {
        firstErr = firstErr ?? e;
      }

      try {
        await Promise.allSettled(Array.from(s.pendingProtocolWrites));
      } catch {
        // ignore
      }

      try {
        await this.deps.backends[s.backend].stopSession(s.handle);
      } catch (e) {
        firstErr = firstErr ?? e;
      }
    } finally {
      this.session = null;
      this.onStats?.({ status: "idle", filesTotal: 0, filesRecognized: 0 });
    }
    if (firstErr) return await Promise.reject(firstErr);
  }
}
