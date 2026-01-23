export type MutableRef<T> = {
  get: () => T;
  set: (next: T) => void;
};

