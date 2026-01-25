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
import { commandExists } from "../os/commandExists";
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
import { DefaultTestTransportController, TestTransportLog } from "../presentation/controllers/testTransportController";
import { AgendaController } from "../application/agenda/agendaController";
import { TEST_TRANSPORT_VIEW_TYPE } from "../views/testTransportView";
import { TransportRegistry } from "../presentation/electronWindow/transport/transportRegistry";
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
  private testTransportRibbonEl?: HTMLElement;
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
    checkLinuxNativeRecordingDependencies: async () => await this.checkLinuxNativeRecordingDependencies(),
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
  private testDialogWindow: { close: () => void; sendMessage: (message: string) => void } | null = null;

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

    // DI (controller-scoped): регистрируем порты/коллбеки, затем резолвим use-cases/controllers из container.
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

    // SettingsUseCase ports
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

    // View controller factories / actions for AgendaController
    this.di.register("assistant.controller.openAgendaView", { useValue: () => void this.activateAgendaView() });
    this.di.register("assistant.controller.openLogView", { useValue: () => void this.activateLogView() });
    this.di.register("assistant.controller.openEvent", { useValue: (ev: Event) => void this.ctx.eventNoteService.openEvent(ev) });
    this.di.register("assistant.controller.openTestDialog", { useValue: () => this.openTestDialog() });
    this.di.register("assistant.controller.sendTestMessage", { useValue: (message: string) => this.sendTestMessage(message) });
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

    // Recording dialog deps
    this.di.register("assistant.controller.warnLinuxNativeDepsOnOpen", { useValue: () => void this.warnLinuxNativeDepsOnRecorderOpen() });
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
          onLog: p.onLog,
          pluginDirPath: this.pluginDirPath,
          transportRegistry: this.di.resolve(TransportRegistry),
        }),
    });

    // Finally: resolve singletons from DI
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
        createTestTransportController: () => this.di.resolve<() => DefaultTestTransportController>("assistant.factory.testTransportController")(),
      },
    );

    const commandsController: CommandsController = {
      openAgenda: () => void this.activateAgendaView(),
      openRecordingDialog: () => void this.openRecordingDialog(),
      openLog: () => void this.activateLogView(),
      openTestTransportPanel: () => void this.activateTestTransportView(),
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

    // Применяем настройки к сервисам
    await this.ctx.applySettings(this.getSettings());
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

    // Persistent cache
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
      // ignore
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
      // ignore
    }
  }

  async checkLinuxNativeRecordingDependencies(): Promise<void> {
    const cmds = ["ffmpeg", "pactl", "pw-record", "parec"];
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
    if (missing.length === 0) return;
    this.notice.show(`Ассистент: Linux Native — не хватает: ${missing.join(", ")} (найдено: ${found.join(", ") || "—"})`);
  }

  private async warnLinuxNativeDepsOnRecorderOpen(): Promise<void> {
    if (this.getSettings().recording.audioBackend !== "linux_native") return;
    try {
      await this.checkLinuxNativeRecordingDependencies();
    } catch (e) {
      this.ctx.logService.warn("Linux Native: проверка зависимостей при открытии диктофона завершилась с ошибкой", {
        error: String((e as unknown) ?? "неизвестная ошибка"),
      });
    }
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
    this.workspace.revealLeaf(leaf as any);
  }

  async activateLogView(): Promise<void> {
    const existing = this.workspace.getLeavesOfType(LOG_VIEW_TYPE);
    const leaf = existing[0] ?? this.workspace.getRightLeaf(false);
    await (leaf as any).setViewState({ type: LOG_VIEW_TYPE, active: true });
    this.workspace.revealLeaf(leaf as any);
  }

  async activateTestTransportView(): Promise<void> {
    const existing = this.workspace.getLeavesOfType(TEST_TRANSPORT_VIEW_TYPE);
    const leaf = existing.length > 0 ? existing[0] : this.workspace.getRightLeaf(false);
    if (!leaf) return;
    await (leaf as any).setViewState({ type: TEST_TRANSPORT_VIEW_TYPE, active: true });
    this.workspace.revealLeaf(leaf);
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

  openTestDialog(): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { openTestDialog } = require("../presentation/electronWindow/test/testDialog");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { handleTestDialogAction } = require("../presentation/electronWindow/bridge/windowActionRouter");

    const dialog = openTestDialog({
      pluginDirPath: this.pluginDirPath,
      transportRegistry: this.di.resolve(TransportRegistry),
      onMessage: (action: { kind: string }) => {
        // Логируем сообщение от диалога
        this.ctx.logService.info(`test_transport_dialog_received`, { action });
        this.di
          .resolve(TestTransportLog)
          .push({ id: `test_transport_${Date.now()}`, ts: Date.now(), direction: "dialog->app", message: action.kind, data: action });
        handleTestDialogAction(action as any, {
          onMessage: (a: { kind: string }) => {
            this.ctx.logService.info(`test_transport_dialog_action`, { kind: a.kind });
          },
        });
      },
    });

    if (dialog) {
      this.testDialogWindow = dialog;
    }
  }

  sendTestMessage(message: string): void {
    if (!this.testDialogWindow) {
      this.ctx.logService.warn("TestDialog: окно не открыто, нельзя отправить сообщение");
      this.di
        .resolve(TestTransportLog)
        .push({ id: `test_transport_${Date.now()}`, ts: Date.now(), direction: "system", message: "test_transport_dialog_not_open" });
      return;
    }
    this.testDialogWindow.sendMessage(message);
    this.ctx.logService.info(`test_transport_app_sent`, { message });
    this.di
      .resolve(TestTransportLog)
      .push({ id: `test_transport_${Date.now()}`, ts: Date.now(), direction: "app->dialog", message, data: { message } });
  }

  private updateRibbonIcons(): void {
    const debugEnabled = this.getSettings().debug?.enabled === true;
    if (debugEnabled) {
      if (!this.logRibbonEl) {
        this.logRibbonEl = this.plugin.addRibbonIcon("list", "Ассистент: Лог", async () => await this.activateLogView());
      }
      if (!this.testTransportRibbonEl) {
        this.testTransportRibbonEl = this.plugin.addRibbonIcon(
          "flask-conical",
          "Test window transport",
          async () => await this.activateTestTransportView(),
        );
      }
      return;
    }

    if (this.logRibbonEl) {
      this.logRibbonEl.remove();
      this.logRibbonEl = undefined;
    }
    if (this.testTransportRibbonEl) {
      this.testTransportRibbonEl.remove();
      this.testTransportRibbonEl = undefined;
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
