import type { App } from "obsidian";
import type { TFile } from "obsidian";
import { normalizePath } from "obsidian";
import { createUniqueMarkdownFile } from "../../vault/fileNaming";
import { formatSegmentsMarkdown } from "../../transcription/transcriptFormat";
import type { TranscriptionProvider } from "../../transcription/transcriptionTypes";
import { stripMarkdownExtension } from "../../domain/policies/wikiLink";

type Logger = {
  info: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

type TranscribeFileUseCaseDeps = {
  app: App;
  getProvider: () => TranscriptionProvider | null;
  log: Logger;
};

/**
 * Use case: транскрипция отдельного звукового файла.
 * Создает .md файл в той же папке с ссылкой на оригинал и текстом транскрипции.
 */
export class TranscribeFileUseCase {
  constructor(private deps: TranscribeFileUseCaseDeps) {}

  async transcribeFile(audioFile: TFile): Promise<TFile> {
    const { app, getProvider, log } = this.deps;

    // Получаем провайдер транскрипции
    const provider = getProvider();
    if (!provider) {
      throw new Error("Транскрипция не настроена. Проверьте настройки плагина.");
    }

    log.info("Транскрипция файла: начало", { file: audioFile.path });

    // Читаем бинарный файл
    const ab = await (app.vault.adapter as any).readBinary(audioFile.path);
    const blob = new Blob([ab]);
    const fileName = audioFile.name;

    // Выполняем транскрипцию
    log.info("Транскрипция файла: отправка запроса", { fileName, fileSize: blob.size });
    const resp = await provider.transcribe({ fileBlob: blob, fileName });
    
    log.info("Транскрипция файла: получен ответ", { 
      segmentsCount: resp.segments.length,
      totalTextLength: resp.segments.reduce((sum, s) => sum + s.text.length, 0),
    });

    // Форматируем транскрипцию
    const transcriptMd = formatSegmentsMarkdown({ segments: resp.segments, fileLabel: fileName });

    // Определяем путь для нового .md файла (в той же папке, с таким же именем)
    const folderPath = normalizePath(audioFile.path.substring(0, audioFile.path.lastIndexOf("/")) || "");
    const baseName = audioFile.basename;

    // Создаем содержимое .md файла
    const audioLinkTarget = stripMarkdownExtension(audioFile.path);
    const audioLink = `[[${audioLinkTarget}|${fileName}]]`;
    const content = `# Расшифровка: ${baseName}\n\n## Оригинальный файл\n\n${audioLink}\n\n${transcriptMd}`;

    // Создаем уникальный .md файл
    const mdFile = await createUniqueMarkdownFile(app.vault, folderPath, baseName, content);

    log.info("Транскрипция файла: завершена", { audioFile: audioFile.path, mdFile: mdFile.path });

    return mdFile;
  }
}
