import type { App } from "obsidian";
import type { AssistantSettings, Event } from "../types";
import { CalendarService } from "../calendar/calendarService";
import { EventNoteService } from "../calendar/eventNoteService";
import { EventNoteIndexCache } from "../calendar/store/eventNoteIndexCache";
import { CalendarEventCache } from "../calendar/store/calendarEventCache";
import { LogFileWriter } from "../log/logFileWriter";
import { LogService } from "../log/logService";
import { NotificationScheduler } from "../notifications/notificationScheduler";
import { OutboxService } from "../offline/outboxService";
import { PersonNoteService } from "../people/personNoteService";
import { ProjectNoteService } from "../projects/projectNoteService";
import { ProtocolNoteService } from "../protocols/protocolNoteService";
import { RecordingService } from "../recording/recordingService";
import { SyncService } from "../sync/syncService";
import { BaseWorkspaceService } from "../base/baseWorkspaceService";
import type { DependencyContainer } from "tsyringe";
import { createAssistantContainer } from "./di/assistantContainer";
import type { MutableRef } from "../shared/mutableRef";

export type PluginContextPaths = {
  logsDirPath: string;
  calendarCacheFilePath: string;
  eventNoteIndexCacheFilePath: string;
  outboxFilePath: string;
  /** Абсолютный путь к директории плагина (для preload скрипта). */
  pluginDirPath: string | null;
};

export type PluginContextActions = {
  createProtocol: (ev: Event) => Promise<unknown>;
  startRecording: (ev: Event) => Promise<unknown>;
  meetingCancelled: (ev: Event) => Promise<unknown>;
};

/**
 * Composition Root (ручной DI) для плагина.
 *
 * Зачем:
 * - вынести wiring из `main.ts`
 * - централизовать применение настроек к зависимым сервисам
 * - упростить дальнейшее выделение Application/Infrastructure границ
 */
export type PluginContext = {
  /** Tsyringe DI container (child container), как единая точка wiring для runtime. */
  container: DependencyContainer;

  logFileWriter: LogFileWriter;
  logService: LogService;

  calendarService: CalendarService;
  eventNoteIndexCache: EventNoteIndexCache;
  eventNoteService: EventNoteService;
  protocolNoteService: ProtocolNoteService;
  personNoteService: PersonNoteService;
  projectNoteService: ProjectNoteService;
  baseWorkspaceService: BaseWorkspaceService;
  calendarEventCache: CalendarEventCache;
  outboxService: OutboxService;
  notificationScheduler: NotificationScheduler;
  recordingService: RecordingService;
  syncService: SyncService;

  applySettings: (settings: AssistantSettings) => Promise<void>;
};

export function createPluginContext(params: {
  app: App;
  settings: AssistantSettings;
  paths: PluginContextPaths;
  actions: PluginContextActions;
  version?: string;
}): PluginContext {
  const { app, paths, actions } = params;

  const settingsRef: MutableRef<AssistantSettings> = {
    get: () => params.settings,
    set: (next) => {
      params.settings = next;
    },
  };

  const container = createAssistantContainer({
    app,
    settingsRef,
    paths,
    actions,
    version: params.version,
  });

  const logFileWriter = new LogFileWriter({
    app,
    logsDirPath: paths.logsDirPath,
    retentionDays: settingsRef.get().log.retentionDays,
  });

  const logService = new LogService(settingsRef.get().log.maxEntries, (entry) => {
    logFileWriter.enqueue(entry);
  });

  // Важно: некоторые зависимости (RecordingUseCase/Facade/Service) резолвятся из container и ожидают logService.
  container.register<LogService>("assistant.logService", { useValue: logService });

  // SyncService зависит от assistant.logService, поэтому регистрируем его только после logService.
  // Также: это должен быть один инстанс на весь runtime (иначе refresh/applySettings расходятся).
  const syncService = new SyncService(
    container.resolve(CalendarService),
    container.resolve(EventNoteService),
    container.resolve(NotificationScheduler),
    logService,
    container.resolve(PersonNoteService),
  );
  container.register(SyncService, { useValue: syncService });

  // Маркер, чтобы по логу было видно, что плагин реально перезагрузился после install:obsidian.
  logService.info("Ассистент: инициализация плагина", {
    version: params.version ?? "",
    ts: new Date().toISOString(),
  });

  const calendarService = container.resolve(CalendarService);
  const eventNoteIndexCache = container.resolve(EventNoteIndexCache);
  const eventNoteService = container.resolve(EventNoteService);
  const protocolNoteService = container.resolve(ProtocolNoteService);
  const personNoteService = container.resolve(PersonNoteService);
  const projectNoteService = container.resolve(ProjectNoteService);
  const baseWorkspaceService = container.resolve(BaseWorkspaceService);
  const calendarEventCache = container.resolve(CalendarEventCache);
  const outboxService = container.resolve(OutboxService);
  const notificationScheduler = container.resolve(NotificationScheduler);

  const recordingService = container.resolve(RecordingService);

  async function applySettings(next: AssistantSettings): Promise<void> {
    settingsRef.set(next);
    logService.setMaxEntries(next.log.maxEntries);
    await logFileWriter.setRetentionDays(next.log.retentionDays);

    // Лог-файлы пишем вне vault (в папку плагина). Конфиг папки/включения не настраивается.
    syncService.applySettings(next);

    // Важно: RecordingService создаётся до loadSettings(), поэтому после загрузки обязаны прокинуть актуальные настройки.
    recordingService.setSettings(next);

    protocolNoteService.setProtocolsDir(next.folders.protocols);
    personNoteService.setPeopleDir(next.folders.people);
    projectNoteService.setProjectsDir(next.folders.projects);
    baseWorkspaceService.setPaths({
      meetingsDir: next.folders.calendarEvents,
      protocolsDir: next.folders.protocols,
      peopleDir: next.folders.people,
      projectsDir: next.folders.projects,
    });
  }

  return {
    container,
    logFileWriter,
    logService,
    calendarService,
    eventNoteIndexCache,
    eventNoteService,
    protocolNoteService,
    personNoteService,
    projectNoteService,
    baseWorkspaceService,
    calendarEventCache,
    outboxService,
    notificationScheduler,
    recordingService,
    syncService,
    applySettings,
  };
}
