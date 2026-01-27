export type RecordingStatus = "idle" | "recording" | "paused";

export type BaseSession = {
  backend: "electron_media_devices" | "g_streamer";
  status: "recording" | "paused";
  startedAtMs: number;
  /** Время старта текущего файла/чанка (нужно для корректной длительности в WebM). */
  currentFileStartedAtMs: number;
  filesTotal: number;
  filesRecognized: number;
  foundProjects: number;
  foundFacts: number;
  foundPeople: number;
  recordingsDir: string;
  filePrefix: string;
  protocolFilePath?: string;
  protocolUpdateChain?: Promise<void>;
  eventKey?: string;
  chunkEveryMs: number;
  lastChunkAtMs: number;
  chunkTimer?: number;
  rotateChain?: Promise<void>;
  stopping?: boolean;
  pendingWrites: Set<Promise<void>>;
};

export type ElectronSession = BaseSession & {
  backend: "electron_media_devices";
  /** Поток, который пишет MediaRecorder (микрофон). */
  mediaStream: MediaStream;
  /** Входные потоки, которые нужно останавливать при stop() (только mic). */
  inputStreams: MediaStream[];
  recorder: MediaRecorder;
  mimeType: string;
  mimeTypePref: string;
  audioCtx?: AudioContext;
  analyser?: AnalyserNode;
  time?: Uint8Array;
  vizSample?: () => void;
  vizTimer?: number;
};

