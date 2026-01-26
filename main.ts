import "reflect-metadata";
import { Notice, Plugin } from "obsidian";
import type { TFile } from "obsidian";
import { DEFAULT_SETTINGS, normalizeSettings } from "./src/settingsStore";
import type { AssistantSettings, Event } from "./src/types";
import { AssistantSettingsTab } from "./src/ui/settingsTab";
import * as path from "node:path";
import { createPluginContext, type PluginContext } from "./src/plugin/pluginContext";
import { AssistantController } from "./src/plugin/assistantController";
import type { SettingsCommand } from "./src/application/settings/settingsCommands";

/**
 * Основной класс Obsidian-плагина “Ассистент”.
 *
 * Здесь выполняется wiring:
 * - инициализация сервисов
 * - регистрация views/команд/настроек
 * - запуск автообновления
 */
export default class AssistantPlugin extends Plugin {
  settings: AssistantSettings = DEFAULT_SETTINGS;
  private ctx!: PluginContext;
  private controller!: AssistantController;
  private initStarted = false;
  // Public services are still exposed for UI sections/tests; wiring moved into PluginContext.
  logFileWriter = undefined as any;
  logService = undefined as any;

  get settingsOps() {
    return this.controller?.settingsOps;
  }

  get caldavAccounts() {
    return this.controller?.caldavAccounts;
  }

  /** Obsidian: lifecycle — регистрация views/команд/настроек и запуск initAsync. */
  async onload() {
    // ВАЖНО: не блокируем регистрацию представлений/кнопок (views/ribbon) на await-IO.
    // Иначе Obsidian может восстановить workspace (наши views) раньше, чем завершится init плагина,
    // что приводит к "plugin is no longer active" и пропавшим ribbon/actions.

    // Инициализируем сервисы дефолтами сразу (без await)
    this.settings = DEFAULT_SETTINGS;
    // controller нужен для actions в NotificationScheduler (в ctx). Используем позднюю привязку.
    let controller: AssistantController | undefined;
    const pluginDirPathForContext = this.getPluginDirPath();
    this.ctx = createPluginContext({
      app: this.app,
      settings: this.settings,
      paths: {
        logsDirPath: this.getPluginLogsDirPath(),
        calendarCacheFilePath: this.getCalendarCacheFilePath(),
        eventNoteIndexCacheFilePath: this.getEventNoteIndexCacheFilePath(),
        outboxFilePath: this.getOutboxFilePath(),
        pluginDirPath: pluginDirPathForContext,
      },
      actions: {
        createProtocol: (ev) => controller?.createProtocolFromEvent(ev) ?? Promise.reject(new Error("Assistant: controller not ready")),
        startRecording: async (ev) => controller?.startRecordingFromReminder(ev),
        meetingCancelled: (ev) => controller?.meetingCancelledFromReminder(ev) ?? Promise.resolve(),
      },
      version: (this.manifest as any)?.version ?? "",
    });
    this.logFileWriter = this.ctx.logFileWriter;
    this.logService = this.ctx.logService;

    this.addSettingTab(new AssistantSettingsTab(this.app, this));

    // Диагностика путей для preload скрипта
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pathModule = require("node:path") as typeof import("node:path");
    const __dirnameValue = __dirname;
    const vaultBasePath = this.getVaultBasePath();
    const pluginDirPath = this.getPluginDirPath();
    const manifestId = this.manifest.id;
    const requireMainFilename = require.main?.filename;
    const requireMainDirname = requireMainFilename ? pathModule.dirname(requireMainFilename) : null;

    console.log("[Assistant] main.ts: Диагностика путей для preload скрипта:");
    console.log(`[Assistant]   __dirname: ${__dirnameValue}`);
    console.log(`[Assistant]   require.main?.filename: ${requireMainFilename || "undefined"}`);
    console.log(`[Assistant]   require.main dirname: ${requireMainDirname || "undefined"}`);
    console.log(`[Assistant]   vaultBasePath: ${vaultBasePath || "null"}`);
    console.log(`[Assistant]   manifest.id: ${manifestId}`);
    console.log(`[Assistant]   pluginDirPath (getPluginDirPath): ${pluginDirPath || "null"}`);
    if (pluginDirPath) {
      const expectedPreloadPath = pathModule.resolve(pluginDirPath, "bridge-preload.cjs");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("node:fs") as typeof import("node:fs");
      const preloadExists = fs.existsSync(expectedPreloadPath);
      console.log(`[Assistant]   expected preload path: ${expectedPreloadPath}`);
      console.log(`[Assistant]   preload file exists: ${preloadExists}`);
    }

    this.controller = controller = new AssistantController({
      plugin: this,
      workspace: this.app.workspace,
      vault: this.app.vault,
      metadataCache: this.app.metadataCache,
      notice: { show: (m) => new Notice(m) },
      ctx: this.ctx,
      getSettings: () => this.settings,
      setSettings: (next) => {
        this.settings = next;
      },
      loadData: () => this.loadData(),
      saveData: (d) => this.saveData(d),
      pluginDirPath: pluginDirPath,
    });

    this.controller.registerPresentation();

    // (Linux) Запись: опционально, разрешаем доступ к микрофону/аудио без всплывающих запросов Chromium.
    // Важно: это работает на уровне Electron session и действует на всё приложение Obsidian для внутренних страниц.
    this.controller.applyRecordingMediaPermissions();

    // Асинхронная инициализация после layoutReady (безопасно при restore workspace)
    this.app.workspace.onLayoutReady(() => {
      if (this.initStarted) return;
      this.initStarted = true;
      void this.controller.initAsync({ normalizeSettings, defaultSettings: DEFAULT_SETTINGS });
    });
  }

  onunload() {
    this.controller?.onunload();
  }

  /** Загрузить настройки из Obsidian `loadData()` и применить нормализацию/миграции. */
  async loadSettings() {
    this.settings = normalizeSettings(await this.loadData());
  }

  /** Запустить OAuth и сохранить refresh‑токен для Google CalDAV аккаунта. */
  async authorizeGoogleCaldav(accountId: string): Promise<void> {
    await this.controller.authorizeGoogleCaldav(accountId);
  }

  /**
   * CalDAV: discovery календарей для аккаунта.
   *
   * Зачем: settings UI не должен импортировать provider напрямую (границы слоёв).
   */
  async discoverCaldavCalendars(accountId: string): Promise<Array<{ displayName: string; url: string }>> {
    return await this.controller.discoverCaldavCalendars(accountId);
  }

  async updateSettings(mutator: (s: AssistantSettings) => void): Promise<void> {
    await this.controller.updateSettings(mutator);
  }

  async applySettingsCommand(cmd: SettingsCommand): Promise<void> {
    await this.controller.applySettingsCommand(cmd);
  }

  async saveSettingsAndApply() {
    await this.controller.saveSettingsAndApply();
  }

  async activateAgendaView(): Promise<void> {
    await this.controller.activateAgendaView();
  }

  async activateLogView(): Promise<void> {
    await this.controller.activateLogView();
  }

  async openRecordingDialog(preferredEvent?: Event): Promise<void> {
    this.controller.openRecordingDialog(preferredEvent);
  }

  async refreshCalendars(): Promise<void> {
    await this.controller.refreshCalendars();
  }

  async refreshCalendar(calendarId: string): Promise<void> {
    await this.controller.refreshCalendar(calendarId);
  }

  async applyOutbox(): Promise<void> {
    await this.controller.applyOutbox();
  }

  async checkLinuxNativeRecordingDependencies(): Promise<void> {
    await this.controller.checkLinuxNativeRecordingDependencies();
  }

  /**
   * Папка логов в системной директории плагина:
   * `<vault>/.obsidian/plugins/<pluginId>/logs`
   *
   * Зачем: не засоряем vault md-файлами логов (меньше шума и случайных коммитов).
   */
  private getPluginLogsDirPath(): string {
    const pluginDirPath = this.getPluginDirPath();
    if (!pluginDirPath) return "";
    return path.join(pluginDirPath, "logs");
  }

  /** Получить абсолютный путь к vault (только desktop). */
  private getVaultBasePath(): string | null {
    // FileSystemAdapter есть на desktop; в tests/stubs его может не быть.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyAdapter = this.app.vault.adapter as any;
    const p = anyAdapter?.getBasePath?.();
    return typeof p === "string" && p ? p : null;
  }

  /** Абсолютный путь к директории плагина: `<vault>/.obsidian/plugins/<pluginId>` */
  private getPluginDirPath(): string | null {
    const basePath = this.getVaultBasePath();
    if (!basePath) return null;
    // Используем path.resolve для гарантированного абсолютного пути
    return path.resolve(basePath, ".obsidian", "plugins", this.manifest.id);
  }

  /** Путь к persistent cache календарей (JSON) в системной директории плагина. */
  private getCalendarCacheFilePath(): string {
    const pluginDirPath = this.getPluginDirPath();
    if (!pluginDirPath) return "";
    return path.join(pluginDirPath, "cache", "calendar-events.json");
  }

  /** Путь к persistent cache индекса заметок встреч (event_key -> filePath). */
  private getEventNoteIndexCacheFilePath(): string {
    const pluginDirPath = this.getPluginDirPath();
    if (!pluginDirPath) return "";
    return path.join(pluginDirPath, "cache", "event-note-index.json");
  }

  /** Путь к outbox (очередь офлайн-изменений) в системной директории плагина. */
  private getOutboxFilePath(): string {
    const pluginDirPath = this.getPluginDirPath();
    if (!pluginDirPath) return "";
    return path.join(pluginDirPath, "outbox.json");
  }

  // Оркестрация вынесена в AssistantController.
}

// (sameLocalDate) вынесено в domain policies
