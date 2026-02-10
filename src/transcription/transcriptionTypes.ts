export type TranscriptSegment = {
  startSec: number;
  endSec: number;
  text: string;
  // Расширенные поля (опциональные, заполняются отдельными сервисами)
  speaker?: string; // ID спикера из диаризации (например, "speaker_0")
  personId?: string; // ID человека из карточки (например, "person-0000sokn7z")
  voiceprint?: string; // Отпечаток голоса (для сопоставления с карточками людей)
  emotions?: string[]; // Эмоциональная окраска (например, ["Деловой", "Оптимистичный"])
  // Метаданные для объединения файлов
  fileOffset?: number; // Смещение времени при объединении нескольких файлов
  sourceFile?: string; // Путь к исходному файлу
};

export type TranscriptionResult = {
  segments: TranscriptSegment[];
  language?: string;
  duration?: number;
};

export interface TranscriptionProvider {
  id: string;
  transcribe(params: { fileBlob: Blob; fileName: string }): Promise<TranscriptionResult>;
}

// Интерфейсы для будущих сервисов
export interface VoiceprintProvider {
  id: string;
  extractVoiceprint(params: { audioBlob: Blob; segment: TranscriptSegment }): Promise<string | null>;
  matchVoiceprint(params: { voiceprint: string; personVoiceprints: Record<string, string> }): Promise<string | null>;
}

export interface EmotionProvider {
  id: string;
  detectEmotions(params: { text: string; audioBlob?: Blob }): Promise<string[]>;
}
