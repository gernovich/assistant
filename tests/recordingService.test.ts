import { describe, expect, it, vi, beforeEach } from "vitest";
import { RecordingService } from "../src/recording/recordingService";

function makeFakeVault() {
  const folders = new Set<string>();
  const files: Array<{ path: string; size: number }> = [];
  return {
    files,
    getAbstractFileByPath: (p: string) => (folders.has(p) ? ({ path: p } as any) : null),
    createFolder: async (p: string) => {
      folders.add(p);
    },
    createBinary: async (path: string, buf: ArrayBuffer) => {
      files.push({ path, size: buf.byteLength });
    },
  };
}

function makeFakeVaultWithMarkdown() {
  const folders = new Set<string>();
  const binaries: Array<{ path: string; size: number }> = [];
  const mdByPath = new Map<string, string>();

  return {
    binaries,
    mdByPath,
    getAbstractFileByPath: (p: string) => {
      if (folders.has(p)) return ({ path: p } as any);
      if (mdByPath.has(p)) return ({ path: p, extension: "md", basename: p.split("/").pop()?.replace(/\.md$/i, "") ?? "x" } as any);
      return null;
    },
    createFolder: async (p: string) => {
      folders.add(p);
    },
    createBinary: async (path: string, buf: ArrayBuffer) => {
      binaries.push({ path, size: buf.byteLength });
    },
    read: async (f: any) => {
      return mdByPath.get(String(f?.path ?? "")) ?? "";
    },
    modify: async (f: any, next: string) => {
      mdByPath.set(String(f?.path ?? ""), String(next ?? ""));
    },
  };
}

class FakeMediaRecorder extends EventTarget {
  public mimeType = "audio/webm";
  public state: "inactive" | "recording" | "paused" = "inactive";
  private tick?: number;

  constructor(private stream: MediaStream) {
    super();
    void stream;
  }

  start(_timesliceMs?: number) {
    this.state = "recording";
  }

  requestData() {
    if (this.state === "inactive") return;
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType });
    // В jsdom `BlobEvent` может отсутствовать — используем обычный Event с полем `data`.
    const e = new Event("dataavailable") as any;
    e.data = blob;
    this.dispatchEvent(e);
  }

  pause() {
    if (this.state !== "recording") return;
    this.state = "paused";
  }

  resume() {
    if (this.state !== "paused") return;
    this.state = "recording";
  }

  stop() {
    if (this.state === "inactive") return;
    // финальный чанк (как обычно делает MediaRecorder при stop)
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType });
    const e = new Event("dataavailable") as any;
    e.data = blob;
    this.dispatchEvent(e);
    this.state = "inactive";
    this.dispatchEvent(new Event("stop"));
    if (this.tick) window.clearInterval(this.tick);
  }
}

function installMediaMocks() {
  const tracks = [{ stop: vi.fn() }];
  const stream = {
    getTracks: () => tracks as any,
  } as unknown as MediaStream;

  const nav = (globalThis as any).navigator ?? {};
  Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
  Object.defineProperty(nav, "mediaDevices", {
    value: { getUserMedia: vi.fn(async () => stream) },
    configurable: true,
  });

  // В jsdom важнее `window.MediaRecorder`, чем `globalThis.MediaRecorder`
  (globalThis as any).MediaRecorder = FakeMediaRecorder;
  if ((globalThis as any).window) {
    (globalThis as any).window.MediaRecorder = FakeMediaRecorder;
  }

  // AudioContext может отсутствовать в jsdom — нам не важна визуализация в этом тесте
  (globalThis as any).AudioContext = undefined;
  if ((globalThis as any).window) {
    (globalThis as any).window.AudioContext = undefined;
  }

  return { stream, tracks };
}

describe("RecordingService flushes chunks on pause/stop", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("writes a file on pause (flush via requestData)", async () => {
    const vault = makeFakeVault();
    const app = { vault } as any;
    installMediaMocks();

    const svc = new RecordingService(app, { recording: { chunkMinutes: 5 } } as any);
    await svc.start({ eventKey: "cal:ev" });
    await svc.pause();

    // flush async createBinary
    await new Promise((r) => setTimeout(r, 0));
    expect(vault.files.length).toBeGreaterThan(0);
    expect(vault.files[0]!.path).toContain("Ассистент/Записи");
  });

  it("pause завершает текущий файл, а resume начинает новый (в результате будет >=2 файлов)", async () => {
    const vault = makeFakeVault();
    const app = { vault } as any;
    installMediaMocks();

    const svc = new RecordingService(app, { recording: { chunkMinutes: 5 } } as any);
    await svc.start({ eventKey: "cal:ev" });
    await svc.pause(); // завершили 1-й файл
    svc.resume(); // начали новую запись (новый файл)
    await svc.stop(); // завершили 2-й файл

    expect(vault.files.length).toBeGreaterThanOrEqual(2);
  });

  it("если задан protocolFilePath, то каждый аудиофайл добавляется в frontmatter files[] протокола", async () => {
    const vault = makeFakeVaultWithMarkdown();
    const app = { vault } as any;
    installMediaMocks();

    const protocolPath = "Ассистент/Протоколы/p.md";
    vault.mdByPath.set(
      protocolPath,
      ["---", "assistant_type: protocol", "protocol_id: x", "files: []", "---", "", "## P"].join("\n"),
    );

    const svc = new RecordingService(app, { recording: { chunkMinutes: 5 } } as any);
    await svc.start({ eventKey: "cal:ev", protocolFilePath: protocolPath });
    await svc.pause(); // создаст минимум 1 бинарник и обновит протокол

    const nextMd = vault.mdByPath.get(protocolPath) ?? "";
    expect(nextMd).toContain('files: ["Ассистент/Записи/');
  });

  it("writes a file on stop even if stop is immediate (final chunk must not be dropped)", async () => {
    const vault = makeFakeVault();
    const app = { vault } as any;
    installMediaMocks();

    const svc = new RecordingService(app, { recording: { chunkMinutes: 5 } } as any);
    await svc.start({ eventKey: "cal:ev" });
    await svc.stop();

    expect(vault.files.length).toBeGreaterThan(0);
  });
});

