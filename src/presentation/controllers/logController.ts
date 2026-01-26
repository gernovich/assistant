import type { LogEntry, LogService } from "../../log/logService";

export type LogController = {
  onChange: (cb: () => void) => () => void;
  list: () => LogEntry[];
  openTodayFile: () => void | Promise<void>;
  clearAll: () => void | Promise<void>;
  openAgenda: () => void | Promise<void>;
};

/**
 * Контроллер представления для LogView.
 *
 * Зачем: LogView должен быть "тонким" и не знать про LogService/LogFileWriter напрямую.
 */
export class DefaultLogController implements LogController {
  constructor(
    private readonly deps: {
      log: LogService;
      openTodayFile: () => void | Promise<void>;
      clearTodayFile: () => void | Promise<void>;
      openAgenda: () => void | Promise<void>;
    },
  ) {}

  onChange(cb: () => void): () => void {
    return this.deps.log.onChange(cb);
  }

  list(): LogEntry[] {
    return this.deps.log.list();
  }

  openTodayFile(): void | Promise<void> {
    return this.deps.openTodayFile();
  }

  async clearAll(): Promise<void> {
    // UX: очищаем и панель, и файл, чтобы "лог как есть" был консистентным.
    this.deps.log.clear();
    try {
      await this.deps.clearTodayFile();
    } catch {
      // Игнорируем ошибки очистки файла.
    }
  }

  openAgenda(): void | Promise<void> {
    return this.deps.openAgenda();
  }
}
