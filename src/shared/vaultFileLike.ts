/**
 * Минимальный структурный тип для файлов vault, чтобы Application слой
 * не зависел от Obsidian типов (`TFile`), но при этом мог передавать “файл”
 * между use-case’ами и репозиториями.
 *
 * В runtime Obsidian `TFile` совместим с этим интерфейсом.
 */
export type VaultFileLike = {
  path: string;
  basename: string;
};
