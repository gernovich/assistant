/** Хаб для передачи визуализации записи в UI. */
export class RecordingVizHub {
  /** Текущий коллбек визуализации. */
  private cb?: (p: { mic01: number; monitor01: number }) => void;

  /** Устанавливает коллбек визуализации. */
  set(cb?: (p: { mic01: number; monitor01: number }) => void): void {
    this.cb = cb;
  }

  /** Возвращает текущий коллбек визуализации. */
  get(): ((p: { mic01: number; monitor01: number }) => void) | undefined {
    return this.cb;
  }

  /** Пытается отправить значение визуализации, не падая при ошибках. */
  tryPush(p: { mic01: number; monitor01: number }): void {
    try {
      this.cb?.(p);
    } catch {
      // Игнорируем ошибки коллбека.
    }
  }
}
