import type { App } from "obsidian";
import { container, type DependencyContainer } from "tsyringe";
import type { AssistantSettings, Event } from "../../types";
import type { PluginContextActions, PluginContextPaths } from "../pluginContext";
import type { MutableRef } from "../../shared/mutableRef";
import { ProtocolAttachmentService } from "../../recording/protocolAttachmentService";
import { RecordingVizHub } from "../../recording/recordingVizHub";
import { createDefaultCalendarProviderRegistry } from "../../calendar/providers/calendarProviderRegistry";
import type { CalendarProviderRegistry } from "../../calendar/providers/calendarProviderRegistry";
import { CalendarService } from "../../calendar/calendarService";
import { RecordingUseCase } from "../../application/recording/recordingUseCase";
import { nextChunkInMsPolicy, shouldRotateChunkPolicy } from "../../domain/policies/recordingChunkTiming";
import { ensureFolder } from "../../vault/ensureFolder";
import { createUseCaseRecordingBackends } from "../../recording/backends/useCaseBackends";
import type { LogService } from "../../log/logService";
import { RecordingFacade } from "../../application/recording/recordingFacade";
import { pickMediaRecorderMimeType } from "../../domain/policies/mediaRecorderMimeType";
import { RecordingService } from "../../recording/recordingService";
import { CalendarEventCache } from "../../calendar/store/calendarEventCache";
import { EventNoteIndexCache } from "../../calendar/store/eventNoteIndexCache";
import { EventNoteService } from "../../calendar/eventNoteService";
import { ProtocolNoteService } from "../../protocols/protocolNoteService";
import { PersonNoteService } from "../../people/personNoteService";
import { ProjectNoteService } from "../../projects/projectNoteService";
import { BaseWorkspaceService } from "../../base/baseWorkspaceService";
import { OutboxService } from "../../offline/outboxService";
import { NotificationScheduler } from "../../notifications/notificationScheduler";
import { SyncService } from "../../sync/syncService";
import { SettingsUseCase } from "../../application/settings/settingsUseCase";
import { UpdateSettingsUseCase } from "../../application/settings/updateSettingsUseCase";
import { ApplySettingsCommandUseCase } from "../../application/settings/applySettingsCommandUseCase";
import { DiscoverCaldavCalendarsUseCase } from "../../application/caldav/discoverCaldavCalendarsUseCase";
import { AuthorizeGoogleCaldavUseCase } from "../../application/caldav/authorizeGoogleCaldavUseCase";
import { CaldavAccountsUseCase } from "../../application/caldav/caldavAccountsUseCase";
import { runGoogleLoopbackOAuth } from "../../caldav/googleOauth";
import { CaldavProvider } from "../../calendar/providers/caldavProvider";
import { RsvpUseCase } from "../../application/calendar/rsvpUseCase";
import { ProtocolUseCase } from "../../application/protocols/protocolUseCase";
import { OutboxApplyUseCase } from "../../application/offline/outboxApplyUseCase";
import { MeetingStatusWritebackUseCase } from "../../application/calendar/meetingStatusWritebackUseCase";
import { ActiveMeetingPartstatUseCase } from "../../application/calendar/activeMeetingPartstatUseCase";
import { PeopleFromMeetingUseCase } from "../../application/people/peopleFromMeetingUseCase";
import { ProtocolFromMeetingUseCase } from "../../application/protocols/protocolFromMeetingUseCase";
import { EmptyProtocolUseCase } from "../../application/protocols/emptyProtocolUseCase";
import { ManualMeetingUseCase } from "../../application/meetings/manualMeetingUseCase";
import { CreatePersonCardUseCase } from "../../application/people/createPersonCardUseCase";
import { CreateProjectCardUseCase } from "../../application/projects/createProjectCardUseCase";
import { ProtocolFromActiveEventUseCase } from "../../application/protocols/protocolFromActiveEventUseCase";
import { CalendarRefreshUseCase } from "../../application/calendar/calendarRefreshUseCase";
import { RecordingDialogUseCase } from "../../application/recording/recordingDialogUseCase";
import { AutoRefreshUseCase } from "../../application/calendar/autoRefreshUseCase";
import { ProtocolIndex } from "../../protocols/protocolIndex";
import { DefaultLogController } from "../../presentation/controllers/logController";
import { AgendaController } from "../../application/agenda/agendaController";
import { DefaultRecordingController } from "../../presentation/controllers/recordingController";

/**
 * Tsyringe container для runtime (child container на инстанс плагина).
 *
 * Важно: пока используем DI без декораторов/emitDecoratorMetadata — регистрируем зависимости явно.
 * Это даёт управляемый wiring и точку расширения, но не ломает текущую архитектуру.
 */
export function createAssistantContainer(params: {
  app: App;
  settingsRef: MutableRef<AssistantSettings>;
  paths: PluginContextPaths;
  actions: PluginContextActions;
  version?: string;
}): DependencyContainer {
  const c = container.createChildContainer();

  // Базовые runtime зависимости (useValue)
  c.register<App>("obsidian.app", { useValue: params.app });
  c.register<MutableRef<AssistantSettings>>("assistant.settingsRef", { useValue: params.settingsRef });
  // Удобный token для случаев, где нужен "снимок" текущих настроек на момент resolve.
  c.register<AssistantSettings>("assistant.settings", { useFactory: (cc) => cc.resolve<MutableRef<AssistantSettings>>("assistant.settingsRef").get() });
  c.register<PluginContextPaths>("assistant.paths", { useValue: params.paths });
  c.register<PluginContextActions>("assistant.actions", { useValue: params.actions });
  c.register<string>("assistant.version", { useValue: params.version ?? "" });

  // Утилиты/поставщики (explicit, чтобы можно было переопределять в тестах/будущих интеграциях)
  c.register<() => number>("clock.nowMs", { useValue: () => Date.now() });

  // RecordingUseCase ожидает `number` (DOM timers).
  c.register<(cb: () => void, ms: number) => number>("clock.setIntervalNumber", { useValue: (cb, ms) => window.setInterval(cb, ms) });
  c.register<(id: number) => void>("clock.clearIntervalNumber", { useValue: (id) => window.clearInterval(id) });

  // AutoRefreshUseCase допускает number|Timeout (в разных окружениях).
  type IntervalId = number | ReturnType<typeof globalThis.setInterval>;
  c.register<(cb: () => void, ms: number) => IntervalId>("clock.setInterval", { useValue: (cb, ms) => window.setInterval(cb, ms) });
  c.register<(id: IntervalId) => void>("clock.clearInterval", { useValue: (id) => globalThis.clearInterval(id as any) });

  // Порты действий (инфраструктура)
  c.register<(ev: Event) => Promise<unknown>>("actions.createProtocol", { useValue: (ev) => params.actions.createProtocol(ev) });
  c.register<(ev: Event) => Promise<unknown>>("actions.startRecording", { useValue: (ev) => params.actions.startRecording(ev) });
  c.register<(ev: Event) => Promise<unknown>>("actions.meetingCancelled", { useValue: (ev) => params.actions.meetingCancelled(ev) });

  // Практическая миграция: часть recording-инфры создаём через container.resolve()
  c.registerSingleton(RecordingVizHub, RecordingVizHub);
  c.register(ProtocolAttachmentService, {
    useFactory: (cc) => new ProtocolAttachmentService(cc.resolve<App>("obsidian.app")),
  });

  // Calendar: registry + service
  c.register<CalendarProviderRegistry>("calendar.providerRegistry", {
    useFactory: (cc) => createDefaultCalendarProviderRegistry(cc.resolve<AssistantSettings>("assistant.settings")),
  });
  c.register(CalendarService, {
    useFactory: (cc) => new CalendarService(cc.resolve<AssistantSettings>("assistant.settings"), cc.resolve<CalendarProviderRegistry>("calendar.providerRegistry")),
  });

  // Recording: use-case + facade + service
  c.register(RecordingUseCase, {
    useFactory: (cc) => {
      const app = cc.resolve<App>("obsidian.app");
      const settingsRef = cc.resolve<MutableRef<AssistantSettings>>("assistant.settingsRef");
      const viz = cc.resolve(RecordingVizHub);
      const protocolAttachmentService = cc.resolve(ProtocolAttachmentService);
      const log = cc.resolve<LogService>("assistant.logService");

      return new RecordingUseCase({
        nowMs: cc.resolve<() => number>("clock.nowMs"),
        setInterval: cc.resolve<(cb: () => void, ms: number) => number>("clock.setIntervalNumber"),
        clearInterval: cc.resolve<(id: number) => void>("clock.clearIntervalNumber"),
        shouldRotateChunk: shouldRotateChunkPolicy,
        nextChunkInMs: nextChunkInMsPolicy,
        ensureRecordingsDir: async (dir) => {
          await ensureFolder(app.vault as any, dir);
        },
        appendRecordingFileToProtocol: async (protocolFilePath, recordingFilePath) => {
          if (!protocolFilePath) return;
          await protocolAttachmentService.appendRecordingFile(protocolFilePath, recordingFilePath);
        },
        backends: createUseCaseRecordingBackends({
          app,
          getSettings: () => settingsRef.get(),
          getOnViz: () => viz.get(),
          log: {
            info: (m, d) => log.info(m, d),
            warn: (m, d) => log.warn(m, d),
            error: (m, d) => log.error(m, d),
          },
        }),
      });
    },
  });

  c.register("recording.pickMimeTypePref", {
    useFactory: () => () =>
      pickMediaRecorderMimeType({
        isSupported: (t) => typeof MediaRecorder !== "undefined" && Boolean((MediaRecorder as any).isTypeSupported?.(t)),
      }),
  });

  c.register(RecordingFacade, {
    useFactory: (cc) => {
      const log = cc.resolve<LogService>("assistant.logService");
      return new RecordingFacade(
        {
          useCase: cc.resolve(RecordingUseCase),
          pickMimeTypePref: cc.resolve<() => string>("recording.pickMimeTypePref"),
          log: { info: (m, d) => log.info(m, d) },
        },
        cc.resolve<AssistantSettings>("assistant.settings"),
      );
    },
  });

  c.register(RecordingService, {
    useFactory: (cc) => new RecordingService({ facade: cc.resolve(RecordingFacade), viz: cc.resolve(RecordingVizHub) }),
  });

  // Vault repos / caches (Infrastructure)
  c.register(EventNoteIndexCache, {
    useFactory: (cc) =>
      new EventNoteIndexCache({
        filePath: cc.resolve<PluginContextPaths>("assistant.paths").eventNoteIndexCacheFilePath,
        logService: () => cc.resolve<LogService>("assistant.logService"),
      }),
  });

  c.register(EventNoteService, {
    useFactory: (cc) =>
      new EventNoteService(
        cc.resolve<App>("obsidian.app"),
        cc.resolve<AssistantSettings>("assistant.settings").folders.calendarEvents,
        cc.resolve(EventNoteIndexCache),
      ),
  });

  c.register(ProtocolNoteService, {
    useFactory: (cc) => new ProtocolNoteService(cc.resolve<App>("obsidian.app"), cc.resolve<AssistantSettings>("assistant.settings").folders.protocols),
  });

  c.register(PersonNoteService, {
    useFactory: (cc) => new PersonNoteService(cc.resolve<App>("obsidian.app"), cc.resolve<AssistantSettings>("assistant.settings").folders.people),
  });

  c.register(ProjectNoteService, {
    useFactory: (cc) => new ProjectNoteService(cc.resolve<App>("obsidian.app"), cc.resolve<AssistantSettings>("assistant.settings").folders.projects),
  });

  c.register(BaseWorkspaceService, {
    useFactory: (cc) => {
      const s = cc.resolve<AssistantSettings>("assistant.settings");
      return new BaseWorkspaceService(cc.resolve<App>("obsidian.app"), {
        meetingsDir: s.folders.calendarEvents,
        protocolsDir: s.folders.protocols,
        peopleDir: s.folders.people,
        projectsDir: s.folders.projects,
      });
    },
  });

  c.register(CalendarEventCache, {
    useFactory: (cc) =>
      new CalendarEventCache({
        filePath: cc.resolve<PluginContextPaths>("assistant.paths").calendarCacheFilePath,
        logService: () => cc.resolve<LogService>("assistant.logService"),
      }),
  });

  c.register(OutboxService, {
    useFactory: (cc) =>
      new OutboxService({
        filePath: cc.resolve<PluginContextPaths>("assistant.paths").outboxFilePath,
        logService: () => cc.resolve<LogService>("assistant.logService"),
      }),
  });

  c.register(NotificationScheduler, {
    useFactory: (cc) => {
      const sRef = cc.resolve<MutableRef<AssistantSettings>>("assistant.settingsRef");
      const actions = cc.resolve<PluginContextActions>("assistant.actions");
      const log = cc.resolve<LogService>("assistant.logService");
      return new NotificationScheduler(sRef.get(), (m) => log.info(m), {
        createProtocol: (ev) => actions.createProtocol(ev),
        startRecording: async (ev) => {
          await actions.startRecording(ev);
        },
        meetingCancelled: async (ev) => {
          await actions.meetingCancelled(ev);
        },
      });
    },
  });

  c.register(SyncService, {
    useFactory: (cc) =>
      new SyncService(
        cc.resolve(CalendarService),
        cc.resolve(EventNoteService),
        cc.resolve(NotificationScheduler),
        cc.resolve<LogService>("assistant.logService"),
        cc.resolve(PersonNoteService),
      ),
  });

  /**
   * Presentation/Application use-cases которые “склеиваются” в AssistantController.
   *
   * Важно: эти фабрики ожидают, что AssistantController зарегистрирует нужные порты/коллбеки в container:
   * - `assistant.controller.*`
   */

  c.register(UpdateSettingsUseCase, {
    useFactory: (cc) =>
      new UpdateSettingsUseCase({
        getSettings: cc.resolve<() => AssistantSettings>("assistant.controller.getSettings"),
        saveSettingsAndApply: cc.resolve<() => Promise<void>>("assistant.controller.saveSettingsAndApply"),
        log: cc.resolve<LogService>("assistant.logService"),
      }),
  });

  c.register(ApplySettingsCommandUseCase, {
    useFactory: (cc) =>
      new ApplySettingsCommandUseCase({
        updateSettings: cc.resolve(UpdateSettingsUseCase),
        nowMs: cc.resolve<() => number>("clock.nowMs"),
        randomHex: cc.resolve<() => string>("assistant.randomHex"),
      }),
  });

  c.register(AuthorizeGoogleCaldavUseCase, {
    useFactory: (cc) =>
      new AuthorizeGoogleCaldavUseCase({
        getSettings: cc.resolve<() => AssistantSettings>("assistant.controller.getSettings"),
        saveSettingsAndApply: cc.resolve<() => Promise<void>>("assistant.controller.saveSettingsAndApply"),
        runOAuthFlow: (pp) => runGoogleLoopbackOAuth(pp),
        openExternal: cc.resolve<(url: string) => void>("assistant.controller.openExternal"),
        notice: cc.resolve<(m: string) => void>("assistant.controller.notice"),
        log: cc.resolve<LogService>("assistant.logService"),
      }),
  });

  c.register(DiscoverCaldavCalendarsUseCase, {
    useFactory: (cc) =>
      new DiscoverCaldavCalendarsUseCase({
        discoverCalendars: async (accountId) => {
          const provider = new CaldavProvider(cc.resolve<() => AssistantSettings>("assistant.controller.getSettings")());
          return await provider.discoverCalendars(accountId);
        },
        notice: cc.resolve<(m: string) => void>("assistant.controller.notice"),
        log: cc.resolve<LogService>("assistant.logService"),
      }),
  });

  c.register(CaldavAccountsUseCase, {
    useFactory: (cc) => {
      const apply = cc.resolve(ApplySettingsCommandUseCase);
      const authorize = cc.resolve(AuthorizeGoogleCaldavUseCase);
      const discover = cc.resolve(DiscoverCaldavCalendarsUseCase);
      const notice = cc.resolve<(m: string) => void>("assistant.controller.notice");
      const log = cc.resolve<LogService>("assistant.logService");
      return new CaldavAccountsUseCase({
        applyAccountUpdate: async (accountId, patch) => await apply.execute({ type: "caldav.account.update", accountId, patch }),
        addAccount: async () => await apply.execute({ type: "caldav.account.add" }),
        removeAccount: async (accountId) => await apply.execute({ type: "caldav.account.remove", accountId }),
        authorizeGoogle: async (accountId) => await authorize.execute(accountId),
        discoverCalendars: async (accountId) => await discover.execute(accountId),
        addCaldavCalendarFromDiscovery: async ({ name, accountId, calendarUrl, color }) =>
          await apply.execute({ type: "calendar.add.caldav", name, accountId, calendarUrl, color }),
        notice,
        log,
      });
    },
  });

  c.register(SettingsUseCase, {
    useFactory: (cc) =>
      new SettingsUseCase({
        log: cc.resolve<LogService>("assistant.logService"),
        getSettingsSummaryForLog: cc.resolve<(s: AssistantSettings) => Record<string, unknown>>("assistant.controller.getSettingsSummaryForLog"),
        saveData: cc.resolve<(s: AssistantSettings) => Promise<void>>("assistant.controller.saveData"),
        applyCoreSettings: cc.resolve<(s: AssistantSettings) => Promise<void>>("assistant.controller.applyCoreSettings"),
        ensureVaultStructure: cc.resolve<(s: AssistantSettings) => Promise<void>>("assistant.controller.ensureVaultStructure"),
        updateOpenViews: cc.resolve<(s: AssistantSettings) => void>("assistant.controller.updateOpenViews"),
        rescheduleNotifications: cc.resolve<() => void>("assistant.controller.rescheduleNotifications"),
        setupAutoRefreshTimer: cc.resolve<() => void>("assistant.controller.setupAutoRefreshTimer"),
        updateRibbonIcons: cc.resolve<() => void>("assistant.controller.updateRibbonIcons"),
        applyRecordingMediaPermissions: cc.resolve<() => void>("assistant.controller.applyRecordingMediaPermissions"),
      }),
  });

  // Индексы/контроллеры Presentation
  c.register(ProtocolIndex, {
    useFactory: (cc) => new ProtocolIndex({ vault: cc.resolve("assistant.controller.vaultPort") as any, metadataCache: cc.resolve("assistant.controller.metadataCachePort") as any }),
  });

  c.register("assistant.factory.agendaController", {
    useFactory: (cc) => () =>
      new AgendaController(cc.resolve<() => AssistantSettings>("assistant.controller.getSettings")(), cc.resolve(CalendarService), {
        openLog: cc.resolve<() => void>("assistant.controller.openLogView"),
        openEvent: cc.resolve<(ev: any) => void>("assistant.controller.openEvent"),
        openRecorder: cc.resolve<(ev: any) => void>("assistant.controller.openRecorder"),
        setMyPartstat: cc.resolve<(ev: any, partstat: any) => Promise<void>>("assistant.controller.setMyPartstat"),
        getProtocolMenuState: cc.resolve<(ev: any) => Promise<any>>("assistant.controller.getProtocolMenuState"),
        openCurrentProtocol: cc.resolve<(ev: any) => void>("assistant.controller.openCurrentProtocol"),
        openLatestProtocol: cc.resolve<(ev: any) => void>("assistant.controller.openLatestProtocol"),
        createProtocol: cc.resolve<(ev: any) => void>("assistant.controller.createProtocolFromEventAction"),
        debugShowReminder: cc.resolve<(ev: any) => void>("assistant.controller.debugShowReminder"),
      }),
  });

  c.register("assistant.factory.logController", {
    useFactory: (cc) =>
      () =>
        new DefaultLogController({
          log: cc.resolve<LogService>("assistant.logService"),
          openTodayFile: cc.resolve<() => void>("assistant.controller.openTodayLogFile"),
          clearTodayFile: cc.resolve<() => void>("assistant.controller.clearTodayLogFile"),
          openAgenda: cc.resolve<() => void>("assistant.controller.openAgendaView"),
        }),
  });

  c.register(RsvpUseCase, {
    useFactory: (cc) =>
      new RsvpUseCase({
        getSettings: cc.resolve<() => AssistantSettings>("assistant.controller.getSettings"),
        setMyPartstatInCalendar: (ev, partstat) => cc.resolve(CalendarService).setMyPartstat(ev, partstat),
        notice: cc.resolve<(m: string) => void>("assistant.controller.notice"),
        log: cc.resolve<LogService>("assistant.logService"),
      }),
  });

  c.register(ProtocolUseCase, {
    useFactory: (cc) =>
      new ProtocolUseCase({
        meetingNotes: cc.resolve(EventNoteService),
        protocols: cc.resolve(ProtocolNoteService),
        notice: cc.resolve<(m: string) => void>("assistant.controller.notice"),
        log: cc.resolve<LogService>("assistant.logService"),
      }),
  });

  // Остальные use-cases из setupUseCases() (singleton per plugin)
  c.register(OutboxApplyUseCase, {
    useFactory: (cc) =>
      new OutboxApplyUseCase({
        list: () => cc.resolve(OutboxService).list(),
        replace: (items) => cc.resolve(OutboxService).replace(items),
        setMyPartstatInCalendar: (p, partstat) => cc.resolve(CalendarService).setMyPartstat({ calendar: p.calendar, id: p.id, summary: "", start: p.start }, partstat as any),
        notice: cc.resolve<(m: string) => void>("assistant.controller.notice"),
        log: cc.resolve<LogService>("assistant.logService"),
      }),
  });

  c.register(MeetingStatusWritebackUseCase, {
    useFactory: (cc) =>
      new MeetingStatusWritebackUseCase({
        getSettings: cc.resolve<() => AssistantSettings>("assistant.controller.getSettings"),
        readMeetingFileText: (f) => (cc.resolve("assistant.controller.vaultPort") as any).read(f as any),
        calendarService: cc.resolve(CalendarService),
        syncService: cc.resolve(SyncService),
        outbox: cc.resolve(OutboxService),
        notice: cc.resolve<(m: string) => void>("assistant.controller.notice"),
        log: cc.resolve<LogService>("assistant.logService"),
        nowMs: cc.resolve<() => number>("clock.nowMs"),
        randomHex: cc.resolve<() => string>("assistant.randomHex"),
      }),
  });

  c.register(ActiveMeetingPartstatUseCase, {
    useFactory: (cc) => {
      const workspace = cc.resolve("assistant.controller.workspacePort") as any;
      const vault = cc.resolve("assistant.controller.vaultPort") as any;
      const mc = cc.resolve("assistant.controller.metadataCachePort") as any;
      return new ActiveMeetingPartstatUseCase({
        getActiveFile: () => workspace.getActiveFile(),
        readFileText: (f) => vault.read(f),
        getFrontmatterCache: (f) => mc.getFileCache(f)?.frontmatter ?? undefined,
        setMyPartstatInCalendar: (p, partstat) => cc.resolve(CalendarService).setMyPartstat({ calendar: p.calendar, id: p.id, summary: "", start: p.start }, partstat),
        enqueueOutbox: (it) => cc.resolve(OutboxService).enqueue(it),
        notice: cc.resolve<(m: string) => void>("assistant.controller.notice"),
        log: cc.resolve<LogService>("assistant.logService"),
        nowMs: cc.resolve<() => number>("clock.nowMs"),
        randomHex: cc.resolve<() => string>("assistant.randomHex"),
      });
    },
  });

  c.register(PeopleFromMeetingUseCase, {
    useFactory: (cc) => {
      const workspace = cc.resolve("assistant.controller.workspacePort") as any;
      const vault = cc.resolve("assistant.controller.vaultPort") as any;
      const mc = cc.resolve("assistant.controller.metadataCachePort") as any;
      return new PeopleFromMeetingUseCase({
        getActiveFile: () => workspace.getActiveFile(),
        getFrontmatterCache: (f) => mc.getFileCache(f)?.frontmatter ?? undefined,
        readFileText: (f) => vault.read(f),
        people: cc.resolve(PersonNoteService),
        notice: cc.resolve<(m: string) => void>("assistant.controller.notice"),
        log: cc.resolve<LogService>("assistant.logService"),
      });
    },
  });

  c.register(ProtocolFromMeetingUseCase, {
    useFactory: (cc) => {
      const workspace = cc.resolve("assistant.controller.workspacePort") as any;
      const vault = cc.resolve("assistant.controller.vaultPort") as any;
      return new ProtocolFromMeetingUseCase({
        getActiveFile: () => workspace.getActiveFile(),
        readFileText: (f) => vault.read(f),
        meetingNotes: cc.resolve(EventNoteService),
        protocols: cc.resolve(ProtocolNoteService),
        notice: cc.resolve<(m: string) => void>("assistant.controller.notice"),
        log: cc.resolve<LogService>("assistant.logService"),
      });
    },
  });

  c.register(EmptyProtocolUseCase, {
    useFactory: (cc) => new EmptyProtocolUseCase({ protocols: cc.resolve(ProtocolNoteService) }),
  });

  c.register(ManualMeetingUseCase, {
    useFactory: (cc) =>
      new ManualMeetingUseCase({
        meetings: cc.resolve(EventNoteService),
        now: () => new Date(),
        nowMs: cc.resolve<() => number>("clock.nowMs"),
        randomHex: cc.resolve<() => string>("assistant.randomHex"),
      }),
  });

  c.register(CreatePersonCardUseCase, {
    useFactory: (cc) =>
      new CreatePersonCardUseCase({
        people: cc.resolve(PersonNoteService),
        notice: cc.resolve<(m: string) => void>("assistant.controller.notice"),
        log: cc.resolve<LogService>("assistant.logService"),
      }),
  });

  c.register(CreateProjectCardUseCase, {
    useFactory: (cc) =>
      new CreateProjectCardUseCase({
        projects: cc.resolve(ProjectNoteService),
        notice: cc.resolve<(m: string) => void>("assistant.controller.notice"),
        log: cc.resolve<LogService>("assistant.logService"),
      }),
  });

  c.register(ProtocolFromActiveEventUseCase, {
    useFactory: (cc) => {
      const workspace = cc.resolve("assistant.controller.workspacePort") as any;
      const mc = cc.resolve("assistant.controller.metadataCachePort") as any;
      return new ProtocolFromActiveEventUseCase({
        getActiveFile: () => workspace.getActiveFile(),
        getFrontmatterCache: (f) => mc.getFileCache(f)?.frontmatter ?? undefined,
        createProtocolFromEvent: cc.resolve<(ev: any) => Promise<{ path: string }>>("assistant.controller.createProtocolFromEvent"),
        notice: cc.resolve<(m: string) => void>("assistant.controller.notice"),
      });
    },
  });

  c.register(CalendarRefreshUseCase, {
    useFactory: (cc) =>
      new CalendarRefreshUseCase({
        getSettings: cc.resolve<() => AssistantSettings>("assistant.controller.getSettings"),
        refreshCalendarsAndSync: (s) => cc.resolve(SyncService).refreshCalendarsAndSync(s),
        refreshOneAndMerge: (id) => cc.resolve(CalendarService).refreshOneAndMerge(id),
        syncFromCurrentEvents: (s) => cc.resolve(SyncService).syncFromCurrentEvents(s),
        notice: cc.resolve<(m: string) => void>("assistant.controller.notice"),
        log: cc.resolve<LogService>("assistant.logService"),
      }),
  });

  c.register(DefaultRecordingController, {
    useFactory: (cc) => new DefaultRecordingController(cc.resolve(RecordingService)),
  });

  c.register(RecordingDialogUseCase, {
    useFactory: (cc) => {
      const vault = cc.resolve("assistant.controller.vaultPort") as any;
      const protocolIndex = cc.resolve(ProtocolIndex);
      return new RecordingDialogUseCase({
        getSettings: cc.resolve<() => AssistantSettings>("assistant.controller.getSettings"),
        getEvents: () => cc.resolve(CalendarService).getEvents(),
        getRecordingsProtocolsList: (limit) => protocolIndex.listRecent({ protocolsRoot: cc.resolve<() => AssistantSettings>("assistant.controller.getSettings")().folders.protocols, limit }),
        warnLinuxNativeDepsOnOpen: cc.resolve<() => void>("assistant.controller.warnLinuxNativeDepsOnOpen"),
        createProtocolFromEvent: async (ev) => (await cc.resolve<(ev: any) => Promise<{ path: string }>>("assistant.controller.createProtocolFromEvent")(ev)).path,
        createEmptyProtocolAndOpen: async () => {
          const r = await cc.resolve(EmptyProtocolUseCase).createAndOpenResult();
          if (!r.ok) return "";
          return r.value.filePath;
        },
        openProtocolByPath: async (protocolFilePath) => {
          const af = vault.getAbstractFileByPath(String(protocolFilePath || ""));
          if (!af) {
            cc.resolve<(m: string) => void>("assistant.controller.notice")("Ассистент: протокол не найден (проверьте путь)");
            return;
          }
          await cc.resolve(ProtocolNoteService).openProtocol(af);
        },
        dialogFactory: cc.resolve<(p: any) => any>("assistant.controller.recordingDialogFactory"),
        notice: cc.resolve<(m: string) => void>("assistant.controller.notice"),
        log: cc.resolve<LogService>("assistant.logService"),
        now: () => new Date(),
      });
    },
  });

  c.register(AutoRefreshUseCase, {
    useFactory: (cc) =>
      new AutoRefreshUseCase({
        getSettings: cc.resolve<() => AssistantSettings>("assistant.controller.getSettings"),
        refreshCalendars: cc.resolve<() => Promise<void>>("assistant.controller.refreshCalendars"),
        setInterval: cc.resolve<(fn: () => void, ms: number) => number | ReturnType<typeof globalThis.setInterval>>("clock.setInterval"),
        clearInterval: cc.resolve<(id: number | ReturnType<typeof globalThis.setInterval>) => void>("clock.clearInterval"),
        log: cc.resolve<LogService>("assistant.logService"),
      }),
  });

  return c;
}

