/**
 * Минимальные порты Obsidian для DIP (чтобы контроллеры/юзкейсы не тянули `App/Plugin/Notice` напрямую).
 *
 * Важно: типы намеренно структурные — реальные объекты Obsidian подходят “как есть”.
 */

export type NoticePort = { show: (message: string) => void };

export type VaultPort = {
  // `any` намеренно: это структурный порт, чтобы реальные типы Obsidian были присваиваемы без
  // проблем контравариантности (ts `strictFunctionTypes`).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAbstractFileByPath: (path: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createFolder: (path: string) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMarkdownFiles: () => any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  read: (file: any) => Promise<string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on: (eventName: "modify", cb: (file: any) => void) => any;
};

export type WorkspacePort = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getLeavesOfType: (viewType: string) => Array<{ view: any }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRightLeaf: (split: boolean) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  revealLeaf: (leaf: any) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getActiveFile: () => any;
};

export type MetadataCachePort = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getFileCache: (file: any) => { frontmatter?: any } | null | undefined;
};

export type PluginPort = {
  addRibbonIcon: (icon: string, title: string, callback: (evt: MouseEvent) => unknown) => HTMLElement;
  // Команды / представления тоже часть инфраструктурного API Obsidian. Держим структурно и “широко”.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addCommand: (cmd: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerView: (viewType: string, creator: (leaf: any) => any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerEvent: (eventRef: any) => void;
};
