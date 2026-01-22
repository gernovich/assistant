import type { App } from "obsidian";
import type { AssistantSettings, Event } from "../types";
import { CalendarService } from "../calendar/calendarService";
import { createDefaultCalendarProviderRegistry } from "../calendar/providers/calendarProviderRegistry";
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

export type PluginContextPaths = {
  logsDirPath: string;
  calendarCacheFilePath: string;
  eventNoteIndexCacheFilePath: string;
  outboxFilePath: string;
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
  const { app, settings, paths, actions } = params;

  const logFileWriter = new LogFileWriter({
    app,
    logsDirPath: paths.logsDirPath,
    retentionDays: settings.log.retentionDays,
  });

  const logService = new LogService(settings.log.maxEntries, (entry) => {
    logFileWriter.enqueue(entry);
  });

  // Маркер, чтобы по логу было видно, что плагин реально перезагрузился после install:obsidian.
  logService.info("Ассистент: инициализация плагина", {
    version: params.version ?? "",
    ts: new Date().toISOString(),
  });

  const calendarService = new CalendarService(settings, createDefaultCalendarProviderRegistry(settings));

  const eventNoteIndexCache = new EventNoteIndexCache({
    filePath: paths.eventNoteIndexCacheFilePath,
    logService: () => logService,
  });

  const eventNoteService = new EventNoteService(app, settings.folders.calendarEvents, eventNoteIndexCache);
  const protocolNoteService = new ProtocolNoteService(app, settings.folders.protocols);
  const personNoteService = new PersonNoteService(app, settings.folders.people);
  const projectNoteService = new ProjectNoteService(app, settings.folders.projects);

  const baseWorkspaceService = new BaseWorkspaceService(app, {
    meetingsDir: settings.folders.calendarEvents,
    protocolsDir: settings.folders.protocols,
    peopleDir: settings.folders.people,
    projectsDir: settings.folders.projects,
  });

  const calendarEventCache = new CalendarEventCache({
    filePath: paths.calendarCacheFilePath,
    logService: () => logService,
  });

  const outboxService = new OutboxService({
    filePath: paths.outboxFilePath,
    logService: () => logService,
  });

  const notificationScheduler = new NotificationScheduler(settings, (msg) => logService.info(msg), {
    createProtocol: (ev) => actions.createProtocol(ev) as Promise<any>,
    startRecording: (ev) => actions.startRecording(ev) as Promise<any>,
    meetingCancelled: (ev) => actions.meetingCancelled(ev) as Promise<any>,
  });

  const recordingService = new RecordingService(app, settings, logService);
  const syncService = new SyncService(calendarService, eventNoteService, notificationScheduler, logService, personNoteService);

  async function applySettings(next: AssistantSettings): Promise<void> {
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

