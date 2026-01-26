/** Хаб для передачи визуализации записи в UI. */
export class RecordingVizHub {
  /** Текущий коллбек визуализации. */
  private cb?: (amp01: number) => void;

  /** Устанавливает коллбек визуализации. */
  set(cb?: (amp01: number) => void): void {
    this.cb = cb;
  }

  /** Возвращает текущий коллбек визуализации. */
  get(): ((amp01: number) => void) | undefined {
    return this.cb;
  }

  /** Пытается отправить значение визуализации, не падая при ошибках. */
  tryPush(amp01: number): void {
    try {
      this.cb?.(amp01);
    } catch {
      // Игнорируем ошибки коллбека.
    }
  }
}
