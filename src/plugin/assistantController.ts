import type { MetadataCachePort, NoticePort, PluginPort, VaultPort, WorkspacePort } from "../presentation/obsidian/obsidianPorts";
import type { AssistantSettings, Event } from "../types";
import type { PluginContext } from "./pluginContext";
import { ensureFolder } from "../vault/ensureFolder";
import { isTFile } from "../vault/ensureFile";
import { AgendaView, AGENDA_VIEW_TYPE } from "../views/agendaView";
import { LOG_VIEW_TYPE } from "../views/logView";
import { registerAssistantCommands } from "../presentation/obsidian/commands/registerAssistantCommands";
import { registerAssistantViews } from "../presentation/obsidian/views/registerAssistantViews";
import { SettingsUseCase } from "../application/settings/settingsUseCase";
import { RsvpUseCase } from "../application/calendar/rsvpUseCase";
import { ProtocolUseCase } from "../application/protocols/protocolUseCase";
import { OutboxApplyUseCase } from "../application/offline/outboxApplyUseCase";
import { MeetingStatusWritebackUseCase } from "../application/calendar/meetingStatusWritebackUseCase";
import { ActiveMeetingPartstatUseCase } from "../application/calendar/activeMeetingPartstatUseCase";
import { PeopleFromMeetingUseCase } from "../application/people/peopleFromMeetingUseCase";
import { ProtocolFromMeetingUseCase } from "../application/protocols/protocolFromMeetingUseCase";
import { EmptyProtocolUseCase } from "../application/protocols/emptyProtocolUseCase";
import { ManualMeetingUseCase } from "../application/meetings/manualMeetingUseCase";
import { CreatePersonCardUseCase } from "../application/people/createPersonCardUseCase";
import { CreateProjectCardUseCase } from "../application/projects/createProjectCardUseCase";
import { ProtocolFromActiveEventUseCase } from "../application/protocols/protocolFromActiveEventUseCase";
import { CalendarRefreshUseCase } from "../application/calendar/calendarRefreshUseCase";
import { RecordingDialogUseCase } from "../application/recording/recordingDialogUseCase";
import { AutoRefreshUseCase } from "../application/calendar/autoRefreshUseCase";
import { RecordingDialog } from "../recording/recordingDialog";
import { CaldavProvider } from "../calendar/providers/caldavProvider";
import { runGoogleLoopbackOAuth } from "../caldav/googleOauth";
import { AuthorizeGoogleCaldavUseCase } from "../application/caldav/authorizeGoogleCaldavUseCase";
import { CaldavAccountsUseCase } from "../application/caldav/caldavAccountsUseCase";
import { DiscoverCaldavCalendarsUseCase } from "../application/caldav/discoverCaldavCalendarsUseCase";
import { UpdateSettingsUseCase } from "../application/settings/updateSettingsUseCase";
import { ApplySettingsCommandUseCase } from "../application/settings/applySettingsCommandUseCase";
import type { SettingsCommand } from "../application/settings/settingsCommands";
import type { CaldavAccountPatch } from "../application/settings/settingsCommands";
import { redactUrlForLog } from "../log/redact";
import { DefaultRecordingController } from "../presentation/controllers/recordingController";
import { DefaultLogController } from "../presentation/controllers/logController";
import { AgendaController } from "../application/agenda/agendaController";
import { TransportRegistry } from "../presentation/electronWindow/transport/transportRegistry";
import {
  listGStreamerRecordingSourcesViaPactl,
  pickMicFromPactl as pickMicFromPactlPolicy,
  pickMonitorFromPactl as pickMonitorFromPactlPolicy,
} from "../recording/gstreamer/gstreamerPactl";
import { commandExists } from "../os/commandExists";
import { execFile as execFileNode, spawn as spawnNode } from "node:child_process";
import * as fsNode from "node:fs";
import * as pathNode from "node:path";
import { createRequire as createRequireNode } from "node:module";
import type { CommandsController } from "../presentation/controllers/commandsController";
import { ProtocolIndex } from "../protocols/protocolIndex";
import type { DependencyContainer } from "tsyringe";

type AssistantControllerParams = {
  plugin: PluginPort;
  workspace: WorkspacePort;
  vault: VaultPort;
  metadataCache: MetadataCachePort;
  notice: NoticePort;
  ctx: PluginContext;
  getSettings: () => AssistantSettings;
  setSettings: (next: AssistantSettings) => void;
  loadData: () => Promise<unknown>;
  saveData: (data: unknown) => Promise<void>;
  /** Абсолютный путь к директории плагина (для preload скрипта). */
  pluginDirPath: string | null;
};

/**
 * Контроллер (оркестрация) для Obsidian-плагина.
 *
 * Зачем: сделать `main.ts` тонким — оставить только lifecycle+делегирование,
 * а всё "склеивание" use-cases/services/UI-actions держать тут.
 */
export class AssistantController {
  private readonly plugin: PluginPort;
  private readonly workspace: WorkspacePort;
  private readonly vault: VaultPort;
  private readonly metadataCache: MetadataCachePort;
  private readonly notice: NoticePort;
  private readonly ctx: PluginContext;
  private readonly getSettings: () => AssistantSettings;
  private readonly setSettings: (next: AssistantSettings) => void;
  private readonly loadData: () => Promise<unknown>;
  private readonly saveData: (data: unknown) => Promise<void>;
  private agendaRibbonEl?: HTMLElement;
  private logRibbonEl?: HTMLElement;
  private recordingRibbonEl?: HTMLElement;

  private meetingStatusApplyTimerByPath = new Map<string, number>();
  private mediaPermissionsInstalled = false;
  private readonly protocolIndex: ProtocolIndex;
  private readonly di: DependencyContainer;

  private outboxApplyUseCase?: OutboxApplyUseCase;
  private meetingStatusWritebackUseCase?: MeetingStatusWritebackUseCase;
  private activeMeetingPartstatUseCase?: ActiveMeetingPartstatUseCase;
  private peopleFromMeetingUseCase?: PeopleFromMeetingUseCase;
  private protocolFromMeetingUseCase?: ProtocolFromMeetingUseCase;
  private emptyProtocolUseCase?: EmptyProtocolUseCase;
  private manualMeetingUseCase?: ManualMeetingUseCase;
  private createPersonCardUseCase?: CreatePersonCardUseCase;
  private createProjectCardUseCase?: CreateProjectCardUseCase;
  private protocolFromActiveEventUseCase?: ProtocolFromActiveEventUseCase;
  private calendarRefreshUseCase?: CalendarRefreshUseCase;
  private recordingDialogUseCase?: RecordingDialogUseCase;
  private autoRefreshUseCase?: AutoRefreshUseCase;
  private authorizeGoogleCaldavUseCase: AuthorizeGoogleCaldavUseCase;
  private caldavAccountsUseCase: CaldavAccountsUseCase;
  private discoverCaldavCalendarsUseCase: DiscoverCaldavCalendarsUseCase;
  private updateSettingsUseCase: UpdateSettingsUseCase;
  private applySettingsCommandUseCase: ApplySettingsCommandUseCase;

  /** Порт для Settings UI: операции (не изменения settings). */
  readonly settingsOps = {
    openAgenda: async () => await this.activateAgendaView(),
    openLogPanel: async () => await this.activateLogView(),
    openTodayLogFile: async () => await this.ctx.logFileWriter.openTodayLog(),
    refreshCalendars: async () => await this.refreshCalendars(),
    refreshCalendar: async (calendarId: string) => await this.refreshCalendar(calendarId),
    applyOutbox: async () => await this.applyOutbox(),
    clearOutbox: async () => await this.ctx.outboxService.clear(),
    getOutboxCount: async () => (await this.ctx.outboxService.list()).length,
    checkGStreamerRecordingDependencies: async () => await this.checkGStreamerRecordingDependencies(),
    listGStreamerRecordingSources: async () => await this.listGStreamerRecordingSources(),
    resolveGStreamerActualSource: async (p: { kind: "mic" | "monitor" }) => await this.resolveGStreamerActualSource(p),
    startGStreamerLevelProbe: async (p: { kind: "mic" | "monitor"; device?: string | null }) => await this.startGStreamerLevelProbe(p),
    stopGStreamerLevelProbe: async (p: { kind: "mic" | "monitor"; device?: string | null }) => await this.stopGStreamerLevelProbe(p),
    probeGStreamerLevel: async (p: { kind: "mic" | "monitor"; device?: string | null }) => await this.probeGStreamerLevel(p),
  };

  /** Порт для Settings UI: CalDAV accounts (use-case facade). */
  readonly caldavAccounts = {
    addAccount: async () => await this.caldavAccountsUseCase.addAccount(),
    updateAccount: async (accountId: string, patch: CaldavAccountPatch) => await this.caldavAccountsUseCase.updateAccount(accountId, patch),
    removeAccount: async (accountId: string) => await this.caldavAccountsUseCase.removeAccount(accountId),
    authorizeGoogle: async (accountId: string) => await this.caldavAccountsUseCase.authorizeGoogleCaldav(accountId),
    discover: async (accountId: string) => await this.caldavAccountsUseCase.discover(accountId),
    addCalendarFromDiscovery: async (p: { name: string; accountId: string; calendarUrl: string; color?: string }) =>
      await this.caldavAccountsUseCase.addCalendarFromDiscovery(p),
  };

  private readonly pluginDirPath: string | null;
  private settingsReady = false;
  private logCommandRegistered = false;

  constructor(p: AssistantControllerParams) {
    this.plugin = p.plugin;
    this.workspace = p.workspace;
    this.vault = p.vault;
    this.metadataCache = p.metadataCache;
    this.notice = p.notice;
    this.ctx = p.ctx;
    this.getSettings = p.getSettings;
    this.setSettings = p.setSettings;
    this.loadData = p.loadData;
    this.saveData = p.saveData;
    this.pluginDirPath = p.pluginDirPath;

    // DI (на уровне контроллера): регистрируем порты/коллбеки, затем резолвим use-case'ы/контроллеры из container.
    this.di = this.ctx.container;
    this.di.register("assistant.controller.workspacePort", { useValue: this.workspace });
    this.di.register("assistant.controller.vaultPort", { useValue: this.vault });
    this.di.register("assistant.controller.metadataCachePort", { useValue: this.metadataCache });
    this.di.register("assistant.controller.getSettings", { useValue: () => this.getSettings() });
    this.di.register("assistant.controller.saveSettingsAndApply", { useValue: () => this.saveSettingsAndApply() });
    this.di.register("assistant.controller.notice", { useValue: (m: string) => this.notice.show(m) });
    this.di.register("assistant.controller.openExternal", { useValue: (url: string) => this.openExternal(url) });
    this.di.register("assistant.controller.saveData", { useValue: (s: AssistantSettings) => this.saveData(s) });
    this.di.register("assistant.controller.applyCoreSettings", {
      useValue: async (s: AssistantSettings) => await this.ctx.applySettings(s),
    });
    this.di.register("assistant.controller.getSettingsSummaryForLog", {
      useValue: (s: AssistantSettings) => this.getSettingsSummaryForLog(s),
    });
    this.di.register("assistant.randomHex", { useValue: () => Math.random().toString(16).slice(2) });

    // Порты SettingsUseCase
    this.di.register("assistant.controller.ensureVaultStructure", {
      useValue: async (s: AssistantSettings) => {
        await ensureFolder(this.vault, s.folders.projects);
        await ensureFolder(this.vault, s.folders.people);
        await ensureFolder(this.vault, s.folders.calendarEvents);
        await ensureFolder(this.vault, s.folders.protocols);
        await this.ctx.baseWorkspaceService.ensureBaseFiles();
        await this.ctx.baseWorkspaceService.syncBaseInFoldersToSettings();
        await this.ctx.eventNoteService.warmUpIndex();
      },
    });
    this.di.register("assistant.controller.updateOpenViews", {
      useValue: (s: AssistantSettings) => {
        for (const leaf of this.workspace.getLeavesOfType(AGENDA_VIEW_TYPE)) {
          const view = leaf.view;
          if (view instanceof AgendaView) view.setSettings(s);
        }
      },
    });
    this.di.register("assistant.controller.rescheduleNotifications", {
      useValue: () => {
        this.ctx.notificationScheduler.schedule(this.ctx.calendarService.getUpcomingEventsForNotifications());
      },
    });
    this.di.register("assistant.controller.setupAutoRefreshTimer", { useValue: () => this.autoRefreshUseCase?.setup() });
    this.di.register("assistant.controller.updateRibbonIcons", { useValue: () => this.updateRibbonIcons() });
    this.di.register("assistant.controller.applyRecordingMediaPermissions", { useValue: () => this.applyRecordingMediaPermissions() });

    // Фабрики контроллеров/действия для AgendaController
    this.di.register("assistant.controller.openAgendaView", { useValue: () => void this.activateAgendaView() });
    this.di.register("assistant.controller.openLogView", { useValue: () => void this.activateLogView() });
    this.di.register("assistant.controller.openEvent", { useValue: (ev: Event) => void this.ctx.eventNoteService.openEvent(ev) });
    this.di.register("assistant.controller.openRecorder", { useValue: (ev: Event) => this.openRecordingDialog(ev) });
    this.di.register("assistant.controller.setMyPartstat", {
      useValue: async (ev: Event, partstat: NonNullable<Event["status"]>) => await this.di.resolve(RsvpUseCase).setMyPartstat(ev, partstat),
    });
    this.di.register("assistant.controller.getProtocolMenuState", {
      useValue: async (ev: Event) => await this.di.resolve(ProtocolUseCase).getMenuState(ev),
    });
    this.di.register("assistant.controller.openCurrentProtocol", {
      useValue: (ev: Event) => void this.di.resolve(ProtocolUseCase).openCurrent(ev),
    });
    this.di.register("assistant.controller.openLatestProtocol", {
      useValue: (ev: Event) => void this.di.resolve(ProtocolUseCase).openLatest(ev),
    });
    this.di.register("assistant.controller.createProtocolFromEventAction", {
      useValue: (ev: Event) => void this.di.resolve(ProtocolUseCase).createOrOpenFromEvent(ev),
    });
    this.di.register("assistant.controller.debugShowReminder", { useValue: (ev: Event) => void this.debugShowReminder(ev) });
    this.di.register("assistant.controller.openTodayLogFile", { useValue: () => void this.ctx.logFileWriter.openTodayLog() });
    this.di.register("assistant.controller.clearTodayLogFile", { useValue: () => void this.ctx.logFileWriter.clearTodayLogFile() });

    // Зависимости диалога записи
    this.di.register("assistant.controller.refreshCalendars", { useValue: async () => await this.refreshCalendars() });
    this.di.register("assistant.controller.createProtocolFromEvent", {
      useValue: async (ev: Event) => await this.createProtocolFromEvent(ev),
    });
    this.di.register("assistant.controller.recordingDialogFactory", {
      useValue: (p: any) =>
        new RecordingDialog({
          settings: p.settings,
          events: p.events,
          protocols: p.protocols,
          defaultEventKey: p.defaultEventKey,
          lockDefaultEvent: p.lockDefaultEvent,
          defaultCreateNewProtocol: p.defaultCreateNewProtocol,
          recordingController: this.di.resolve(DefaultRecordingController),
          onCreateProtocol: p.onCreateProtocol,
          onCreateEmptyProtocol: p.onCreateEmptyProtocol,
          onOpenProtocol: p.onOpenProtocol,
          onClosed: p.onClosed,
          onLog: p.onLog,
          pluginDirPath: this.pluginDirPath,
          transportRegistry: this.di.resolve(TransportRegistry),
        }),
    });

    // Финально: резолвим singleton'ы из DI
    this.protocolIndex = this.di.resolve(ProtocolIndex);
    this.authorizeGoogleCaldavUseCase = this.di.resolve(AuthorizeGoogleCaldavUseCase);
    this.discoverCaldavCalendarsUseCase = this.di.resolve(DiscoverCaldavCalendarsUseCase);
    this.updateSettingsUseCase = this.di.resolve(UpdateSettingsUseCase);
    this.applySettingsCommandUseCase = this.di.resolve(ApplySettingsCommandUseCase);
    this.caldavAccountsUseCase = this.di.resolve(CaldavAccountsUseCase);
  }

  async updateSettings(mutator: (s: AssistantSettings) => void): Promise<void> {
    void (await this.updateSettingsUseCase.updateResult(mutator));
  }

  async applySettingsCommand(cmd: SettingsCommand): Promise<void> {
    await this.applySettingsCommandUseCase.execute(cmd);
  }

  /**
   * Зарегистрировать views/commands. Важно вызывать до async init, чтобы Obsidian workspace restore не ломался.
   */
  registerPresentation(): void {
    const rsvpUseCase = this.di.resolve(RsvpUseCase);
    const protocolUseCase = this.di.resolve(ProtocolUseCase);

    registerAssistantViews(
      this.plugin,
      { settings: this.getSettings() },
      {
        createAgendaController: () => this.di.resolve<() => AgendaController>("assistant.factory.agendaController")(),
        createLogController: () => this.di.resolve<() => DefaultLogController>("assistant.factory.logController")(),
      },
    );

    const commandsController: CommandsController = {
      openAgenda: () => void this.activateAgendaView(),
      openRecordingDialog: () => void this.openRecordingDialog(),
      openLog: () => void this.activateLogView(),
      refreshCalendars: () => void this.refreshCalendars(),
      createMeetingCard: () => void this.createManualMeetingCard(),
      createProtocolCard: () => void this.createEmptyProtocolCard(),
      createProtocolFromOpenMeeting: () => void this.createProtocolFromOpenMeeting(),
      createPersonCard: () => void this.createPersonCard(),
      createProjectCard: () => void this.createProjectCard(),
      createPeopleFromAttendees: () => void this.createPeopleCardsFromActiveMeeting(),
      applyOutbox: () => void this.applyOutbox(),
      eventStatusAccepted: () => void this.setActiveEventPartstat("accepted"),
      eventStatusDeclined: () => void this.setActiveEventPartstat("declined"),
      eventStatusTentative: () => void this.setActiveEventPartstat("tentative"),
      eventStatusNeedsAction: () => void this.setActiveEventPartstat("needs_action"),
      applyStatusFromMeetingNote: () => void this.applyStatusFromActiveMeetingNote(),
      createProtocolFromActiveEvent: () => void this.createProtocolFromActiveEvent(),
    };
    registerAssistantCommands(this.plugin, commandsController);

    this.setupRibbonIcons();
    this.updateRibbonIcons();
  }

  /**
   * Асинхронная инициализация после layoutReady.
   */
  async initAsync(params: { normalizeSettings: (raw: unknown) => AssistantSettings; defaultSettings: AssistantSettings }): Promise<void> {
    const { normalizeSettings, defaultSettings } = params;
    try {
      const next = normalizeSettings(await this.loadData());
      this.setSettings(next);
    } catch (e) {
      this.ctx.logService.warn("Настройки: не удалось загрузить, использую defaults", { error: e });
      this.setSettings(defaultSettings);
    }
    this.settingsReady = true;

    // Применяем настройки к сервисам
    await this.ctx.applySettings(this.getSettings());
    this.updateRibbonIcons();
    this.ctx.logService.info("Настройки: загружены и применены", { settings: this.getSettingsSummaryForLog(this.getSettings()) });

    // Обновляем уже восстановленные views загруженными настройками
    for (const leaf of this.workspace.getLeavesOfType(AGENDA_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof AgendaView) view.setSettings(this.getSettings());
    }

    // Обеспечиваем папки
    try {
      const s = this.getSettings();
      await ensureFolder(this.vault, s.folders.projects);
      await ensureFolder(this.vault, s.folders.people);
      await ensureFolder(this.vault, s.folders.calendarEvents);
      await ensureFolder(this.vault, s.folders.protocols);
      await this.ctx.baseWorkspaceService.ensureBaseFiles();
      await this.ctx.eventNoteService.warmUpIndex();
    } catch (e) {
      this.ctx.logService.error("Vault: не удалось создать базовую структуру", { error: e });
    }

    // Постоянный кэш
    await this.ctx.calendarEventCache.loadIntoCalendarService(this.ctx.calendarService, {
      enabledCalendarIds: this.getSettings()
        .calendars.filter((c) => c.enabled)
        .map((c) => c.id),
    });
    this.ctx.calendarService.onChange(() => {
      void this.ctx.calendarEventCache.saveFromCalendarService(this.ctx.calendarService, {
        enabledCalendarIds: this.getSettings()
          .calendars.filter((c) => c.enabled)
          .map((c) => c.id),
        maxEventsPerCalendar: this.getSettings().calendar.persistentCacheMaxEventsPerCalendar,
      });
    });

    this.setupUseCases();
    this.setupMeetingStatusAutoWriteBack();
    await this.refreshCalendars();
    this.autoRefreshUseCase?.setup();
  }

  onunload(): void {
    this.autoRefreshUseCase?.stop();
    this.ctx.notificationScheduler?.clear();
    void this.ctx.logFileWriter?.flush();
  }

  async saveSettingsAndApply(): Promise<void> {
    const res = await this.di.resolve(SettingsUseCase).saveAndApplyResult(this.getSettings());
    if (!res.ok) {
      // Не спамим notice на каждый onChange — только лог (уже есть) + мягкий notice один раз.
      // В идеале: добавить rate-limit/one-shot, но пока оставляем максимально простым.
      this.notice.show(`Ассистент: ${res.error.message}`);
    }
  }

  async authorizeGoogleCaldav(accountId: string): Promise<void> {
    await this.authorizeGoogleCaldavUseCase.execute(accountId);
  }

  async discoverCaldavCalendars(accountId: string): Promise<Array<{ displayName: string; url: string }>> {
    return await this.discoverCaldavCalendarsUseCase.execute(accountId);
  }

  private openExternal(url: string): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require("electron") as { shell?: { openExternal?: (u: string) => void } };
      if (electron?.shell?.openExternal) {
        electron.shell.openExternal(url);
        return;
      }
    } catch {
      // Игнорируем ошибки — в этом случае откроем ссылку через window.open.
    }
    window.open(url);
  }

  applyRecordingMediaPermissions(): void {
    if (this.mediaPermissionsInstalled) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let electron: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      electron = require("electron");
    } catch {
      return;
    }

    const session = electron?.remote?.session?.defaultSession ?? electron?.session?.defaultSession;
    const setHandler = session?.setPermissionRequestHandler;
    if (typeof setHandler !== "function") return;

    try {
      session.setPermissionRequestHandler((_wc: unknown, permission: string, callback: (allow: boolean) => void, details: any) => {
        const url = String(details?.requestingUrl ?? details?.requestURL ?? "");
        const isInternal = url.startsWith("app://obsidian.md") || url.startsWith("file:") || url.startsWith("data:");
        if (!isInternal) {
          callback(false);
          return;
        }
        if (permission === "media" || permission === "display-capture") {
          callback(true);
          return;
        }
        if (permission === "notifications") {
          callback(true);
          return;
        }
        callback(false);
      });
      this.mediaPermissionsInstalled = true;
    } catch {
      // Игнорируем ошибку установки обработчика прав.
    }
  }

  async checkGStreamerRecordingDependencies(): Promise<void> {
    const cmds = ["gst-launch-1.0", "gst-inspect-1.0"];
    const found: string[] = [];
    const missing: string[] = [];
    for (const c of cmds) {
      try {
        if (await commandExists(c)) found.push(c);
        else missing.push(c);
      } catch {
        missing.push(c);
      }
    }

    // Проверяем node + gst-kit через отдельный node-процесс (в renderer gst-kit может падать из-за document/app://).
    const pluginRoot = this.pluginDirPath && typeof this.pluginDirPath === "string" ? this.pluginDirPath : process.cwd();
    const nodeBin = await this.pickNodeBinaryOrNull();
    if (!nodeBin) {
      if (missing.length === 0) this.notice.show("Ассистент: GStreamer — node не найден (нужен для gst-kit probe)");
      return;
    }
    try {
      const proc = spawnNode(
        nodeBin,
        [
          "-e",
          `const Gst=require("gst-kit"); const ee=Gst?.Pipeline?.elementExists;` +
            `const ok=!!Gst && !!ee && ee("pulsesrc") && ee("level");` +
            `process.exit(ok?0:2);`,
        ],
        { cwd: pluginRoot, stdio: ["ignore", "ignore", "ignore"] },
      );
      const code = await new Promise<number | null>((resolve) => proc.on("exit", (c) => resolve(c)));
      if (code && code !== 0) {
        this.notice.show("Ассистент: GStreamer — gst-kit/плагины не готовы (проверьте установку GStreamer)");
      }
    } catch {
      this.notice.show("Ассистент: GStreamer — не удалось запустить gst-kit probe (node/gst-kit)");
    }

    if (missing.length === 0) {
      this.notice.show(`Ассистент: GStreamer — зависимости OK (${found.join(", ")})`);
      return;
    }
    this.notice.show(`Ассистент: GStreamer — не хватает: ${missing.join(", ")} (найдено: ${found.join(", ") || "—"})`);
  }

  private getNodeRequire(): NodeRequire | null {
    try {
      const base =
        this.pluginDirPath && typeof this.pluginDirPath === "string"
          ? pathNode.join(this.pluginDirPath, "main.js")
          : typeof __filename === "string"
            ? __filename
            : pathNode.join(process.cwd(), "main.js");
      return createRequireNode(base);
    } catch {
      return null;
    }
  }

  private gstreamerProbeSessions = new Map<
    string,
    {
      proc: import("child_process").ChildProcess | null;
      running: boolean;
      lastRms?: number;
      requestedDevice: string;
      actualDevice: string;
      stderrTail: string;
    }
  >();

  private getGstreamerProbeKey(params: { kind: "mic" | "monitor"; device?: string | null }): string {
    const raw = String(params.device ?? "auto").trim();
    const keyDevice = raw ? raw : "auto";
    return `${params.kind}:${keyDevice}`;
  }

  private async pickMonitorFromPactl(): Promise<string> {
    return await pickMonitorFromPactlPolicy();
  }

  private async pickMicFromPactl(): Promise<string> {
    return await pickMicFromPactlPolicy();
  }

  // gst-kit нельзя безопасно require() в renderer (см. document/createRequire(app://...)).
  // Поэтому прямой загрузки здесь нет — только через child-process.

  private extractRmsFromAny(value: any, depth = 0): number[] | null {
    if (!value || depth > 4) return null;
    if (Array.isArray(value)) {
      if (value.length > 0 && typeof value[0] === "number") return value as number[];
      return null;
    }
    if (typeof value === "object") {
      if (Array.isArray(value.rms)) return value.rms as number[];
      for (const key of Object.keys(value)) {
        const found = this.extractRmsFromAny((value as any)[key], depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  private getLevelRms(msg: any): number[] | null {
    if (!msg) return null;
    const structure = msg.structure || msg.structureValue || msg.value || null;
    const structureName = msg.structureName || (structure && structure.name) || null;
    if (structureName !== "level") return null;
    if (Array.isArray(msg.rms) && msg.rms.length > 0) return msg.rms as number[];
    if (structure) {
      const rms = this.extractRmsFromAny(structure);
      if (Array.isArray(rms) && rms.length > 0) return rms;
    }
    return null;
  }

  async startGStreamerLevelProbe(
    params: { kind: "mic" | "monitor"; device?: string | null },
  ): Promise<{ ok: boolean; error?: string; actualDevice?: string }> {
    const key = this.getGstreamerProbeKey(params);
    if (this.gstreamerProbeSessions.has(key)) {
      const existing = this.gstreamerProbeSessions.get(key);
      return { ok: true, actualDevice: existing?.actualDevice };
    }

    const requested = String(params.device ?? "auto").trim() || "auto";
    let actualDevice = requested;
    if (requested === "auto") {
      if (params.kind === "monitor") actualDevice = await this.pickMonitorFromPactl();
      else actualDevice = await this.pickMicFromPactl();
    }

    const session = {
      proc: null as import("child_process").ChildProcess | null,
      running: true,
      lastRms: undefined as number | undefined,
      requestedDevice: requested,
      actualDevice,
      stderrTail: "",
    };
    this.gstreamerProbeSessions.set(key, session);

    // В Obsidian plugin-рантайме есть `document`, из-за чего gst-kit (cjs) пытается работать как браузерный модуль
    // и падает на createRequire(app://...). Поэтому делаем probe в отдельном node-процессе без DOM.
    const pluginRoot = this.pluginDirPath && typeof this.pluginDirPath === "string" ? this.pluginDirPath : process.cwd();
    const probeScript = `
      const Gst = require("gst-kit");
      const device = String(process.env.DEVICE || "");
      const src = device ? ("pulsesrc device=" + device) : "pulsesrc";
      const desc = src + " ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=1 ! level name=level0 interval=100000000 message=true ! fakesink sync=false";
      const p = new Gst.Pipeline(desc);
      const level = p.getElementByName ? p.getElementByName("level0") : null;
      if (level && level.setElementProperty) { try { level.setElementProperty("message", true); } catch {} try { level.setElementProperty("post-messages", true); } catch {} }
      let running = true;
      const loop = async () => {
        while (running) {
          const msg = await p.busPop(100);
          if (!msg) continue;
          if (msg.type === "error") {
            try { process.stderr.write(String(JSON.stringify(msg.parseError ? msg.parseError() : msg)) + "\\n"); } catch {}
            continue;
          }
          const structure = msg.structure || msg.structureValue || msg.value || null;
          const structureName = msg.structureName || (structure && structure.name) || null;
          if (structureName !== "level") continue;
          const rms = Array.isArray(msg.rms) ? msg.rms : (structure && structure.rms);
          if (!Array.isArray(rms) || rms.length === 0) continue;
          const db = Number(rms[0]);
          if (!Number.isFinite(db)) continue;
          process.stdout.write(JSON.stringify({ rmsDb: db }) + "\\n");
        }
      };
      process.on("SIGTERM", () => { running = false; try { p.stop && p.stop(); } catch {} process.exit(0); });
      process.on("SIGINT", () => { running = false; try { p.stop && p.stop(); } catch {} process.exit(0); });
      (async () => { await p.play(); await loop(); })().catch((e) => { try { process.stderr.write(String(e && e.stack || e) + "\\n"); } catch {} process.exit(1); });
    `;

    // eslint-disable-next-line no-console
    if (this.getSettings().debug?.enabled) console.log("[assistant][gstreamer][probe:start]", { kind: params.kind, requested: requested, actualDevice, cwd: pluginRoot });

    const nodeBin = await this.pickNodeBinaryOrNull();
    if (!nodeBin) {
      // eslint-disable-next-line no-console
      console.warn("[assistant][gstreamer] node not found; probe disabled");
      return { ok: false, error: "node не найден (нужен для запуска GStreamer probe процесса)", actualDevice };
    }
    const proc = spawnNode(nodeBin, ["-e", probeScript], {
      cwd: pluginRoot,
      env: { ...process.env, DEVICE: actualDevice },
      stdio: ["ignore", "pipe", "pipe"],
    });
    session.proc = proc;

    let stdoutBuf = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += String(chunk ?? "");
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) {
        const s = String(line ?? "").trim();
        if (!s) continue;
        try {
          const obj = JSON.parse(s);
          const db = Number(obj?.rmsDb);
          if (Number.isFinite(db)) session.lastRms = db;
        } catch {
          // ignore junk
        }
      }
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      session.stderrTail = (session.stderrTail + String(chunk ?? "")).slice(-2000);
    });
    proc.on("exit", (code) => {
      session.running = false;
      if (this.getSettings().debug?.enabled) {
        // eslint-disable-next-line no-console
        console.warn("[assistant][gstreamer][probe:exit]", { code, stderrTail: session.stderrTail.slice(-500) });
      }
      this.gstreamerProbeSessions.delete(key);
    });

    return { ok: true, actualDevice };
  }

  private cachedNodeBinary: string | null = null;

  private async pickNodeBinaryOrNull(): Promise<string | null> {
    if (this.cachedNodeBinary) return this.cachedNodeBinary;

    const candidates: string[] = [];
    const envNode = String(process.env.ASSISTANT_NODE_BINARY ?? process.env.NODE_BINARY ?? "").trim();
    if (envNode) candidates.push(envNode);
    candidates.push("node");
    candidates.push("/usr/bin/node", "/usr/local/bin/node", "/bin/node");

    for (const c of candidates) {
      const bin = String(c || "").trim();
      if (!bin) continue;
      if (bin !== "node") {
        try {
          if (!fsNode.existsSync(bin)) continue;
        } catch {
          continue;
        }
      } else {
        try {
          const ok = await commandExists("node");
          if (!ok) continue;
        } catch {
          continue;
        }
      }
      const ok = await this.canRunNode(bin);
      if (!ok) continue;
      this.cachedNodeBinary = bin;
      return bin;
    }
    return null;
  }

  private async canRunNode(bin: string): Promise<boolean> {
    try {
      const r = await new Promise<{ ok: boolean }>((resolve) => {
        execFileNode(bin, ["--version"], { timeout: 800 }, (err) => resolve({ ok: !err }));
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  async stopGStreamerLevelProbe(params: { kind: "mic" | "monitor"; device?: string | null }): Promise<void> {
    const key = this.getGstreamerProbeKey(params);
    const session = this.gstreamerProbeSessions.get(key);
    if (!session) return;
    session.running = false;
    try {
      session.proc?.kill("SIGTERM");
    } catch {
      // ignore
    }
    this.gstreamerProbeSessions.delete(key);
  }

  async probeGStreamerLevel(params: { kind: "mic" | "monitor"; device?: string | null }): Promise<{ rmsDb?: number; error?: string }> {
    const key = this.getGstreamerProbeKey(params);
    const session = this.gstreamerProbeSessions.get(key);
    if (!session) return { rmsDb: undefined };
    return { rmsDb: session.lastRms };
  }

  private async execShell(cmd: string, timeoutMs = 2000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    return await new Promise((resolve) => {
      execFileNode("sh", ["-lc", cmd], { timeout: timeoutMs }, (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      });
    });
  }

  async listGStreamerRecordingSources(): Promise<{ micSources: string[]; monitorSources: string[] }> {
    return await listGStreamerRecordingSourcesViaPactl();
  }

  async resolveGStreamerActualSource(params: { kind: "mic" | "monitor" }): Promise<string> {
    if (params.kind === "monitor") {
      return await this.pickMonitorFromPactl();
    }
    return await this.pickMicFromPactl();
  }

  async refreshCalendars(): Promise<void> {
    await this.calendarRefreshUseCase?.refreshAll();
  }

  async refreshCalendar(calendarId: string): Promise<void> {
    await this.calendarRefreshUseCase?.refreshOne(calendarId);
  }

  async createProtocolFromEvent(ev: Event): Promise<{ path: string }> {
    return (await this.di.resolve(ProtocolUseCase).createOrOpenFromEvent(ev)) as any;
  }

  startRecordingFromReminder(ev: Event): void {
    this.openRecordingDialog(ev);
  }

  async meetingCancelledFromReminder(ev: Event): Promise<void> {
    await this.ctx.eventNoteService.markCancelled(ev);
    await this.ctx.eventNoteService.openEvent(ev);
    this.ctx.logService.warn("Встреча помечена как отменена", { meeting: ev.summary, id: ev.id, calendarId: ev.calendar.id });
  }

  openRecordingDialog(preferredEvent?: Event): void {
    void this.recordingDialogUseCase?.open(preferredEvent);
  }

  private setupUseCases(): void {
    this.outboxApplyUseCase = this.di.resolve(OutboxApplyUseCase);
    this.meetingStatusWritebackUseCase = this.di.resolve(MeetingStatusWritebackUseCase);
    this.activeMeetingPartstatUseCase = this.di.resolve(ActiveMeetingPartstatUseCase);
    this.peopleFromMeetingUseCase = this.di.resolve(PeopleFromMeetingUseCase);
    this.protocolFromMeetingUseCase = this.di.resolve(ProtocolFromMeetingUseCase);
    this.emptyProtocolUseCase = this.di.resolve(EmptyProtocolUseCase);
    this.manualMeetingUseCase = this.di.resolve(ManualMeetingUseCase);
    this.createPersonCardUseCase = this.di.resolve(CreatePersonCardUseCase);
    this.createProjectCardUseCase = this.di.resolve(CreateProjectCardUseCase);
    this.protocolFromActiveEventUseCase = this.di.resolve(ProtocolFromActiveEventUseCase);
    this.calendarRefreshUseCase = this.di.resolve(CalendarRefreshUseCase);
    this.recordingDialogUseCase = this.di.resolve(RecordingDialogUseCase);
    this.autoRefreshUseCase = this.di.resolve(AutoRefreshUseCase);
  }

  async applyOutbox(): Promise<void> {
    await this.outboxApplyUseCase?.applyAll();
  }

  private async setActiveEventPartstat(partstat: "accepted" | "declined" | "tentative" | "needs_action"): Promise<void> {
    await this.activeMeetingPartstatUseCase?.apply(partstat);
  }

  private async createPeopleCardsFromActiveMeeting(): Promise<void> {
    await this.peopleFromMeetingUseCase?.createPeopleCardsFromActiveMeeting();
  }

  private setupMeetingStatusAutoWriteBack(): void {
    this.plugin.registerEvent(
      this.vault.on("modify", (file) => {
        if (!file || !isTFile(file)) return;
        const p = String(file.path ?? "");
        if (!p.endsWith(".md")) return;

        const prev = this.meetingStatusApplyTimerByPath.get(p);
        if (prev) window.clearTimeout(prev);
        const t = window.setTimeout(() => {
          void this.applyStatusFromMeetingFile(file, { silent: true });
        }, 600);
        this.meetingStatusApplyTimerByPath.set(p, t);
      }),
    );
  }

  private async applyStatusFromActiveMeetingNote(): Promise<void> {
    const file = this.workspace.getActiveFile();
    if (!file) {
      this.notice.show("Ассистент: откройте заметку встречи");
      return;
    }
    await this.applyStatusFromMeetingFile(file, { silent: false });
  }

  private async applyStatusFromMeetingFile(file: { path: string }, opts: { silent: boolean }): Promise<void> {
    await this.meetingStatusWritebackUseCase?.applyFromMeetingFile(file, opts);
  }

  private async createManualMeetingCard(): Promise<void> {
    await this.manualMeetingUseCase?.createAndOpen();
  }

  private async createEmptyProtocolCard(): Promise<void> {
    await this.emptyProtocolUseCase?.createAndOpen();
  }

  private createPersonCard(): void {
    void this.createPersonCardUseCase?.createAndOpen();
  }

  private createProjectCard(): void {
    void this.createProjectCardUseCase?.createAndOpen();
  }

  private async createProtocolFromOpenMeeting(): Promise<void> {
    await this.protocolFromMeetingUseCase?.createFromActiveMeeting();
  }

  private debugShowReminder(ev: Event): void {
    if (!this.getSettings().debug.enabled) {
      this.notice.show("Ассистент: включите «Отладка» в настройках");
      return;
    }
    this.ctx.notificationScheduler.debugShowReminder(ev);
  }

  private async createProtocolFromActiveEvent(): Promise<void> {
    await this.protocolFromActiveEventUseCase?.createFromActiveEvent();
  }

  async activateAgendaView(): Promise<void> {
    const existing = this.workspace.getLeavesOfType(AGENDA_VIEW_TYPE);
    const leaf = existing[0] ?? this.workspace.getRightLeaf(false);
    await (leaf as any).setViewState({ type: AGENDA_VIEW_TYPE, active: true });
    this.closeExtraLeaves(existing, leaf);
    this.workspace.revealLeaf(leaf as any);
  }

  async activateLogView(): Promise<void> {
    const existing = this.workspace.getLeavesOfType(LOG_VIEW_TYPE);
    const leaf = existing[0] ?? this.workspace.getRightLeaf(false);
    await (leaf as any).setViewState({ type: LOG_VIEW_TYPE, active: true });
    this.closeExtraLeaves(existing, leaf);
    this.workspace.revealLeaf(leaf as any);
  }

  private closeExtraLeaves(existing: Array<any>, keepLeaf?: unknown): void {
    for (const leaf of existing) {
      if (keepLeaf && leaf === keepLeaf) continue;
      try {
        (leaf as any).detach?.();
      } catch {
        // Игнорируем ошибки закрытия лишних вкладок.
      }
    }
  }

  private setupRibbonIcons(): void {
    if (!this.agendaRibbonEl) {
      this.agendaRibbonEl = this.plugin.addRibbonIcon("calendar", "Ассистент: Повестка", async () => await this.activateAgendaView());
    }
    if (!this.recordingRibbonEl) {
      this.recordingRibbonEl = this.plugin.addRibbonIcon("microphone", "Ассистент: Диктофон", async () => {
        this.openRecordingDialog();
      });
    }
  }

  private updateRibbonIcons(): void {
    if (!this.settingsReady) return;
    const debugEnabled = this.getSettings().debug?.enabled === true;
    if (debugEnabled) {
      this.ensureDebugCommandsEnabled();
      if (!this.logRibbonEl) {
        this.logRibbonEl = this.plugin.addRibbonIcon("list", "Ассистент: Лог", async () => await this.activateLogView());
      }
      return;
    }

    this.disableDebugCommands();
    this.closeExtraLeaves(this.workspace.getLeavesOfType(LOG_VIEW_TYPE));

    if (this.logRibbonEl) {
      this.logRibbonEl.remove();
      this.logRibbonEl = undefined;
    }
  }

  private ensureDebugCommandsEnabled(): void {
    if (!this.logCommandRegistered) {
      this.plugin.addCommand({ id: "open-log", name: "Открыть лог", callback: () => this.activateLogView() });
      this.logCommandRegistered = true;
    }
  }

  private disableDebugCommands(): void {
    const commands = (this.plugin as any)?.app?.commands;
    if (this.logCommandRegistered) {
      try {
        commands?.removeCommand?.("open-log");
      } catch {
        // ignore
      }
      this.logCommandRegistered = false;
    }
  }

  private getSettingsSummaryForLog(s: AssistantSettings = this.getSettings()): Record<string, unknown> {
    const caldavAccounts = (s.caldav?.accounts ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      enabled: a.enabled,
      authMethod: a.authMethod,
      serverUrl: redactUrlForLog(a.serverUrl),
      username: a.username,
      // пароли/токены намеренно не логируем
      oauth:
        a.authMethod === "google_oauth"
          ? {
              clientId: a.oauth?.clientId ?? "",
              clientSecret: "***",
              refreshToken: "***",
            }
          : undefined,
    }));

    const calendars = (s.calendars ?? []).map((c) => {
      if (c.type === "ics_url") {
        return { id: c.id, name: c.name, type: c.type, enabled: c.enabled, url: redactUrlForLog((c as any).url ?? "") };
      }
      if (c.type === "caldav") {
        return {
          id: c.id,
          name: c.name,
          type: c.type,
          enabled: c.enabled,
          caldav: {
            accountId: (c as any).caldav?.accountId ?? "",
            calendarUrl: redactUrlForLog((c as any).caldav?.calendarUrl ?? ""),
          },
        };
      }
      return { id: c.id, name: c.name, type: (c as any).type, enabled: c.enabled };
    });

    return {
      recording: s.recording,
      log: s.log,
      notifications: s.notifications,
      calendar: {
        autoRefreshEnabled: s.calendar.autoRefreshEnabled,
        autoRefreshMinutes: s.calendar.autoRefreshMinutes,
        myEmail: s.calendar.myEmail,
        persistentCacheMaxEventsPerCalendar: s.calendar.persistentCacheMaxEventsPerCalendar,
      },
      folders: s.folders,
      calendars,
      caldavAccounts,
    };
  }
}
