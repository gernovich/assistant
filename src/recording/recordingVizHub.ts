export class RecordingVizHub {
  private cb?: (amp01: number) => void;

  set(cb?: (amp01: number) => void): void {
    this.cb = cb;
  }

  get(): ((amp01: number) => void) | undefined {
    return this.cb;
  }

  tryPush(amp01: number): void {
    try {
      this.cb?.(amp01);
    } catch {
      // ignore
    }
  }
}
