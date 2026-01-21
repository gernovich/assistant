import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import type { TFile } from "obsidian";
import { CalendarService } from "./src/calendar/calendarService";
import { EventNoteService } from "./src/calendar/eventNoteService";
import { LogFileWriter } from "./src/log/logFileWriter";
import { LogService } from "./src/log/logService";
import { NotificationScheduler } from "./src/notifications/notificationScheduler";
import { DEFAULT_SETTINGS, normalizeSettings } from "./src/settingsStore";
import type { AssistantSettings, Calendar, Event } from "./src/types";
import { AssistantSettingsTab } from "./src/ui/settingsTab";
import { CaldavProvider } from "./src/calendar/providers/caldavProvider";
import { ensureFolder } from "./src/vault/ensureFolder";
import { AgendaView, AGENDA_VIEW_TYPE } from "./src/views/agendaView";
import { LOG_VIEW_TYPE, LogView } from "./src/views/logView";
import { SyncService } from "./src/sync/syncService";
import { ProtocolNoteService } from "./src/protocols/protocolNoteService";
import { runGoogleLoopbackOAuth } from "./src/caldav/googleOauth";
import * as path from "node:path";
import { BaseWorkspaceService } from "./src/base/baseWorkspaceService";
import { CalendarEventCache } from "./src/calendar/store/calendarEventCache";
import { EventNoteIndexCache } from "./src/calendar/store/eventNoteIndexCache";
import { OutboxService } from "./src/offline/outboxService";
import type { OutboxItemV1 } from "./src/offline/outboxService";
import { isTFile } from "./src/vault/ensureFile";
import { parseFrontmatterMap, splitFrontmatter, upsertFrontmatter } from "./src/vault/frontmatter";
import { PersonNoteService } from "./src/people/personNoteService";
import { ProjectNoteService } from "./src/projects/projectNoteService";
import { makeEventKey } from "./src/ids/stableIds";
import { RecordingService } from "./src/recording/recordingService";
import { RecordingDialog } from "./src/recording/recordingDialog";
import { pickDefaultRecordingTarget } from "./src/recording/recordingTarget";
import { commandExists } from "./src/os/commandExists";
import { redactUrlForLog } from "./src/log/redact";

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
  calendarService!: CalendarService;
  eventNoteService!: EventNoteService;
  protocolNoteService!: ProtocolNoteService;
  personNoteService!: PersonNoteService;
  projectNoteService!: ProjectNoteService;
  baseWorkspaceService!: BaseWorkspaceService;
  calendarEventCache!: CalendarEventCache;
  eventNoteIndexCache!: EventNoteIndexCache;
  outboxService!: OutboxService;
  logFileWriter!: LogFileWriter;
  logService!: LogService;
  notificationScheduler!: NotificationScheduler;
  syncService!: SyncService;
  recordingService!: RecordingService;
  private refreshTimer?: number;
  private initStarted = false;
  private agendaRibbonEl?: HTMLElement;
  private logRibbonEl?: HTMLElement;
  private recordingRibbonEl?: HTMLElement;
  private meetingStatusApplyTimerByPath = new Map<string, number>();
  private recentlyAppliedMeetingStatusByEventKey = new Map<string, { status: string; atMs: number }>();
  private mediaPermissionsInstalled = false;

  private normalizeMailtoEmail(v: string): string {
    const s = String(v ?? "").trim().toLowerCase();
    const m = s.match(/^mailto:(.+)$/i);
    return (m ? m[1] : s).trim().toLowerCase();
  }

  private splitEmails(raw: string): string[] {
    return String(raw ?? "")
      .split(/[,\s;]+/g)
      .map((x) => this.normalizeMailtoEmail(x))
      .filter(Boolean);
  }

  private getMyEmailsForEvent(ev: Event): string[] {
    const cfg = this.settings.calendars.find((c) => c.id === ev.calendar.id);
    let raw = String(this.settings.calendar.myEmail ?? "").trim();
    if (!raw && cfg?.type === "caldav") {
      const acc = this.settings.caldav.accounts.find((a) => a.id === cfg.caldav?.accountId);
      raw = String(acc?.username ?? "").trim();
    }
    return this.splitEmails(raw);
  }

  private hasMyAttendee(ev: Event, myEmails: string[]): boolean {
    if (!myEmails.length) return false;
    const a = ev.attendees ?? [];
    for (const x of a) {
      const email = this.normalizeMailtoEmail(String(x?.email ?? ""));
      if (email && myEmails.includes(email)) return true;
    }
    return false;
  }

  /** Obsidian: lifecycle — регистрация views/команд/настроек и запуск initAsync. */
  async onload() {
    // ВАЖНО: не блокируем регистрацию представлений/кнопок (views/ribbon) на await-IO.
    // Иначе Obsidian может восстановить workspace (наши views) раньше, чем завершится init плагина,
    // что приводит к "plugin is no longer active" и пропавшим ribbon/actions.

    // Инициализируем сервисы дефолтами сразу (без await)
    this.settings = DEFAULT_SETTINGS;
    this.logFileWriter = new LogFileWriter({
      app: this.app,
      logsDirPath: this.getPluginLogsDirPath(),
      retentionDays: this.settings.log.retentionDays,
    });
    this.logService = new LogService(this.settings.log.maxEntries, (entry) => {
      this.logFileWriter.enqueue(entry);
    });
    // Маркер, чтобы по логу было видно, что плагин реально перезагрузился после install:obsidian.
    this.logService.info("Ассистент: инициализация плагина", {
      version: (this.manifest as any)?.version ?? "",
      ts: new Date().toISOString(),
    });
    this.calendarService = new CalendarService(this.settings);
    this.eventNoteIndexCache = new EventNoteIndexCache({
      filePath: this.getEventNoteIndexCacheFilePath(),
      logService: () => this.logService,
    });
    this.eventNoteService = new EventNoteService(this.app, this.settings.folders.calendarEvents, this.eventNoteIndexCache);
    this.protocolNoteService = new ProtocolNoteService(this.app, this.settings.folders.protocols);
    this.personNoteService = new PersonNoteService(this.app, this.settings.folders.people);
    this.projectNoteService = new ProjectNoteService(this.app, this.settings.folders.projects);
    this.baseWorkspaceService = new BaseWorkspaceService(this.app, {
      meetingsDir: this.settings.folders.calendarEvents,
      protocolsDir: this.settings.folders.protocols,
      peopleDir: this.settings.folders.people,
      projectsDir: this.settings.folders.projects,
    });
    this.calendarEventCache = new CalendarEventCache({
      filePath: this.getCalendarCacheFilePath(),
      logService: () => this.logService,
    });
    this.outboxService = new OutboxService({
      filePath: this.getOutboxFilePath(),
      logService: () => this.logService,
    });
    this.notificationScheduler = new NotificationScheduler(this.settings, (msg) => this.logService.info(msg), {
      createProtocol: (ev) => this.createProtocolFromEvent(ev),
      startRecording: (ev) => this.startRecordingFromReminder(ev),
      meetingCancelled: (ev) => this.meetingCancelledFromReminder(ev),
    });
    this.recordingService = new RecordingService(this.app, this.settings, this.logService);
    this.syncService = new SyncService(this.calendarService, this.eventNoteService, this.notificationScheduler, this.logService, this.personNoteService);

    this.addSettingTab(new AssistantSettingsTab(this.app, this));

    this.registerView(
      AGENDA_VIEW_TYPE,
      (leaf: WorkspaceLeaf) =>
        new AgendaView(
          leaf,
          this.settings,
          this.calendarService,
          () => void this.activateLogView(),
          (ev) => void this.eventNoteService.openEvent(ev),
          async (ev, partstat) => {
            try {
              const myEmails = this.getMyEmailsForEvent(ev);
              if (!myEmails.length) {
                new Notice("Ассистент: невозможно определить мой email для RSVP (проверьте myEmail/логин CalDAV)");
                return;
              }
              if (!this.hasMyAttendee(ev, myEmails)) {
                new Notice("Ассистент: RSVP недоступен — ваш email не найден среди ATTENDEE этой встречи");
                return;
              }
              await this.calendarService.setMyPartstat(ev, partstat);
            } catch (e) {
              const msg = String((e as unknown) ?? "неизвестная ошибка");
              new Notice(`Ассистент: не удалось изменить статус в календаре: ${msg}`);
              this.logService.error("RSVP: не удалось изменить статус в календаре", { error: msg, eventKey: `${ev.calendar.id}:${ev.id}` });
            }
            for (const l of this.app.workspace.getLeavesOfType(AGENDA_VIEW_TYPE)) {
              const v = l.view;
              if (v instanceof AgendaView) v.refresh();
            }
          },
          (ev) => this.getProtocolMenuState(ev),
          (ev) => void this.openCurrentProtocolFromEvent(ev),
          (ev) => void this.openLatestProtocolFromEvent(ev),
          (ev) => void this.createProtocolFromEvent(ev),
          (ev) => this.openRecordingDialog(ev),
          (ev) => void this.debugShowReminder(ev),
        ),
    );

    this.registerView(
      LOG_VIEW_TYPE,
      (leaf: WorkspaceLeaf) =>
        new LogView(
          leaf,
          this.logService,
          () => void this.logFileWriter.openTodayLog(),
          () => void this.logFileWriter.clearTodayLogFile(),
          () => void this.activateAgendaView(),
        ),
    );

    // Используем встроенные иконки для стабильности при включении/выключении плагина без рестарта Obsidian.
    this.agendaRibbonEl = this.addRibbonIcon("calendar", "Ассистент: Повестка", async () => this.activateAgendaView());

    // Встроенные lucide-иконки в Obsidian могут отличаться по имени; "microphone" более совместимо, чем "mic".
    this.recordingRibbonEl = this.addRibbonIcon("microphone", "Ассистент: Диктофон", async () => this.openRecordingDialog());
    
    // Кнопку “Лог” показываем только в debug-режиме (см. updateRibbonIcons()).
    this.updateRibbonIcons();

    // (Linux) Запись: опционально, разрешаем доступ к микрофону/аудио без всплывающих запросов Chromium.
    // Важно: это работает на уровне Electron session и действует на всё приложение Obsidian для внутренних страниц.
    this.applyRecordingMediaPermissions();

    this.addCommand({
      id: "open-agenda",
      name: "Открыть повестку",
      callback: () => this.activateAgendaView(),
    });

    this.addCommand({
      id: "recording-open-dialog",
      name: "Диктофон",
      callback: () => void this.openRecordingDialog(),
    });

    this.addCommand({
      id: "open-log",
      name: "Открыть лог",
      callback: () => this.activateLogView(),
    });

    this.addCommand({
      id: "refresh-calendars",
      name: "Обновить календари",
      callback: () => this.refreshCalendars(),
    });

    this.addCommand({
      id: "create-meeting-card",
      name: "Создать карточку встречи",
      callback: () => void this.createManualMeetingCard(),
    });

    this.addCommand({
      id: "create-protocol-card",
      name: "Создать карточку протокола",
      callback: () => void this.createEmptyProtocolCard(),
    });

    this.addCommand({
      id: "create-protocol-from-open-meeting",
      name: "Создать протокол из открытой карточки",
      callback: () => void this.createProtocolFromOpenMeeting(),
    });

    this.addCommand({
      id: "create-person-card",
      name: "Создать карточку человека",
      callback: () => void this.personNoteService.createAndOpen(),
    });

    this.addCommand({
      id: "create-project-card",
      name: "Создать карточку проекта",
      callback: () => void this.projectNoteService.createAndOpen(),
    });

    this.addCommand({
      id: "meeting-create-people-from-attendees",
      name: "Создать карточки людей из участников",
      callback: () => void this.createPeopleCardsFromActiveMeeting(),
    });

    this.addCommand({
      id: "apply-outbox",
      name: "Применить офлайн-очередь",
      callback: () => void this.applyOutbox(),
    });

    this.addCommand({
      id: "event-status-accepted",
      name: "Принято (в календаре, из заметки встречи)",
      callback: () => void this.setActiveEventPartstat("accepted"),
    });
    this.addCommand({
      id: "event-status-declined",
      name: "Отклонено (в календаре, из заметки встречи)",
      callback: () => void this.setActiveEventPartstat("declined"),
    });
    this.addCommand({
      id: "event-status-tentative",
      name: "Возможно (в календаре, из заметки встречи)",
      callback: () => void this.setActiveEventPartstat("tentative"),
    });
    this.addCommand({
      id: "event-status-needs-action",
      name: "Нет ответа (в календаре, из заметки встречи)",
      callback: () => void this.setActiveEventPartstat("needs_action"),
    });

    this.addCommand({
      id: "meeting-apply-status-from-note",
      name: "Применить статус из заметки в календарь",
      callback: () => void this.applyStatusFromActiveMeetingNote(),
    });

    this.addCommand({
      id: "create-meeting-from-active-event",
      name: "Создать протокол из текущей встречи",
      callback: () => this.createProtocolFromActiveEvent(),
    });

    // Асинхронная инициализация после layoutReady (безопасно при restore workspace)
    this.app.workspace.onLayoutReady(() => {
      if (this.initStarted) return;
      this.initStarted = true;
      void this.initAsync();
    });
  }

  onunload() {
    if (this.refreshTimer) window.clearInterval(this.refreshTimer);
    this.notificationScheduler?.clear();
    void this.logFileWriter?.flush();
  }

  /** Загрузить настройки из Obsidian `loadData()` и применить нормализацию/миграции. */
  async loadSettings() {
    this.settings = normalizeSettings(await this.loadData());
  }

  /** Запустить OAuth и сохранить refresh‑токен для Google CalDAV аккаунта. */
  async authorizeGoogleCaldav(accountId: string): Promise<void> {
    const acc = this.settings.caldav.accounts.find((a) => a.id === accountId);
    if (!acc) throw new Error("CalDAV аккаунт не найден");

    const oauth = acc.oauth ?? { clientId: "", clientSecret: "", refreshToken: "" };
    if (!oauth.clientId || !oauth.clientSecret) {
      new Notice("Ассистент: заполните clientId/clientSecret для Google OAuth");
      return;
    }

    if (!acc.username.trim()) {
      new Notice("Ассистент: заполните Login (email) для CalDAV аккаунта");
      return;
    }

    // Scope для Google CalDAV
    const scope = "https://www.googleapis.com/auth/calendar";

    const openExternal = (url: string) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const electron = require("electron") as { shell?: { openExternal?: (u: string) => void } };
        if (electron?.shell?.openExternal) {
          electron.shell.openExternal(url);
          return;
        }
      } catch {
        // игнорируем
      }
      window.open(url);
    };

    let refreshToken = "";
    try {
      ({ refreshToken } = await runGoogleLoopbackOAuth({
        clientId: oauth.clientId,
        clientSecret: oauth.clientSecret,
        scope,
        openExternal,
      }));
    } catch (e) {
      const raw = String((e as unknown) ?? "неизвестная ошибка");
      const short = raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
      this.logService.error("CalDAV: Google OAuth ошибка", { error: raw });
      new Notice(`Ассистент: Google OAuth ошибка: ${short}. Подробности в логе.`);
      return;
    }

    acc.authMethod = "google_oauth";
    // Google CalDAV v2: serverUrl должен быть корнем /caldav/v2/ (без email),
    // иначе tsdav discovery может не найти principal/homeUrl ("cannot find homeUrl").
    acc.serverUrl = "https://apidata.googleusercontent.com/caldav/v2/";
    acc.oauth = { ...oauth, refreshToken };

    await this.saveSettingsAndApply();
    this.logService.info("CalDAV: Google OAuth ok (refresh_token сохранён)", { account: acc.name });
    new Notice("Ассистент: Google OAuth OK");
  }

  /**
   * CalDAV: discovery календарей для аккаунта.
   *
   * Зачем: settings UI не должен импортировать provider напрямую (границы слоёв).
   */
  async discoverCaldavCalendars(accountId: string): Promise<Array<{ displayName: string; url: string }>> {
    const provider = new CaldavProvider(this.settings);
    return await provider.discoverCalendars(accountId);
  }

  private async initAsync() {
    try {
      await this.loadSettings();
    } catch (e) {
      console.error("Ассистент: не удалось загрузить настройки", e);
      this.settings = DEFAULT_SETTINGS;
    }

    // Применяем настройки к сервисам
    this.logService.setMaxEntries(this.settings.log.maxEntries);
    await this.logFileWriter.setRetentionDays(this.settings.log.retentionDays);
    // Лог-файлы пишем вне vault (в папку плагина). Конфиг папки/включения не настраивается.
    this.syncService.applySettings(this.settings);
    // Важно: RecordingService создаётся до loadSettings(), поэтому после загрузки обязаны прокинуть актуальные настройки.
    this.recordingService.setSettings(this.settings);
    this.logService.info("Настройки: загружены и применены", { settings: this.getSettingsSummaryForLog() });
    this.protocolNoteService.setProtocolsDir(this.settings.folders.protocols);
    this.personNoteService.setPeopleDir(this.settings.folders.people);
    this.projectNoteService.setProjectsDir(this.settings.folders.projects);
    this.baseWorkspaceService.setPaths({
      meetingsDir: this.settings.folders.calendarEvents,
      protocolsDir: this.settings.folders.protocols,
      peopleDir: this.settings.folders.people,
      projectsDir: this.settings.folders.projects,
    });

    // Обновляем уже восстановленные views загруженными настройками (важно для debug-элементов UI и т.п.)
    for (const leaf of this.app.workspace.getLeavesOfType(AGENDA_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof AgendaView) view.setSettings(this.settings);
    }

    // Обеспечиваем папки, но не “роняем” плагин, если vault read-only / путь невалидный
    try {
      await ensureFolder(this.app.vault, this.settings.folders.projects);
      await ensureFolder(this.app.vault, this.settings.folders.people);
      await ensureFolder(this.app.vault, this.settings.folders.calendarEvents);
      await ensureFolder(this.app.vault, this.settings.folders.protocols);
      await this.baseWorkspaceService.ensureBaseFiles();
      await this.eventNoteService.warmUpIndex();
    } catch (e) {
      console.error("Ассистент: не удалось создать папки в vault", e);
      this.logService.error("Не удалось создать папки в vault");
    }

    // Persistent cache: чтобы после рестарта повестка могла показать last-good данные без сети.
    await this.calendarEventCache.loadIntoCalendarService(this.calendarService, {
      enabledCalendarIds: this.settings.calendars.filter((c) => c.enabled).map((c) => c.id),
    });
    this.calendarService.onChange(() => {
      void this.calendarEventCache.saveFromCalendarService(this.calendarService, {
        enabledCalendarIds: this.settings.calendars.filter((c) => c.enabled).map((c) => c.id),
        maxEventsPerCalendar: this.settings.calendar.persistentCacheMaxEventsPerCalendar,
      });
    });

    // Автосинк RSVP из заметки: если пользователь меняет `status:` в карточке встречи,
    // пытаемся записать PARTSTAT обратно в CalDAV, затем синхронизируем карточки.
    this.setupMeetingStatusAutoWriteBack();

    await this.refreshCalendars();
    this.setupAutoRefreshTimer();
  }

  async saveSettingsAndApply() {
    // Важно для диагностики: что именно применяется и в каком режиме запись.
    // Секреты (пароли/токены) редактируем.
    const summary = this.getSettingsSummaryForLog();
    this.logService.info("Настройки: сохранить+применить (start)", { settings: summary });
    try {
      await this.saveData(this.settings);
      this.logService.setMaxEntries(this.settings.log.maxEntries);
      await this.logFileWriter.setRetentionDays(this.settings.log.retentionDays);
      // Лог-файлы пишем вне vault (в папку плагина). Конфиг папки/включения не настраивается.
      this.syncService.applySettings(this.settings);
      this.protocolNoteService.setProtocolsDir(this.settings.folders.protocols);
      this.recordingService.setSettings(this.settings);
      this.baseWorkspaceService.setPaths({
        meetingsDir: this.settings.folders.calendarEvents,
        protocolsDir: this.settings.folders.protocols,
        peopleDir: this.settings.folders.people,
        projectsDir: this.settings.folders.projects,
      });
    } catch (e) {
      const msg = String((e as unknown) ?? "неизвестная ошибка");
      this.logService.error("Настройки: сохранить+применить (ошибка)", { error: msg, settings: summary });
      throw e;
    }

    // Если пользователь поменял папки карточек — создаём новые папки и синхронизируем `.base` (file.inFolder).
    try {
      await ensureFolder(this.app.vault, this.settings.folders.projects);
      await ensureFolder(this.app.vault, this.settings.folders.people);
      await ensureFolder(this.app.vault, this.settings.folders.calendarEvents);
      await ensureFolder(this.app.vault, this.settings.folders.protocols);
      await this.baseWorkspaceService.ensureBaseFiles();
      await this.baseWorkspaceService.syncBaseInFoldersToSettings();
      await this.eventNoteService.warmUpIndex();
    } catch (e) {
      console.error("Ассистент: не удалось обновить папки/.base", e);
      this.logService.warn("Не удалось обновить папки/.base (проверьте права vault)");
    }

    // Обновляем уже открытые views повестки
    for (const leaf of this.app.workspace.getLeavesOfType(AGENDA_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof AgendaView) view.setSettings(this.settings);
    }

    // Перепланируем уведомления по текущим событиям
    this.notificationScheduler.schedule(this.calendarService.getUpcomingEventsForNotifications());

    this.setupAutoRefreshTimer();
    this.updateRibbonIcons();

    // Применяем настройку авто-разрешения доступа к микрофону (если пользователь включил её в Settings).
    this.applyRecordingMediaPermissions();

    this.logService.info("Настройки: сохранены и применены (ok)", { settings: this.getSettingsSummaryForLog() });
  }

  private getSettingsSummaryForLog(): Record<string, unknown> {
    const s = this.settings;
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

  async checkLinuxNativeRecordingDependencies(): Promise<void> {
    // Для текущей реализации Linux Native нужны как минимум: ffmpeg + pactl (PulseAudio/PipeWire-Pulse).
    // pw-record/parec оставляем как "возможные" утилиты для будущих реализаций/диагностики.
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
    if (missing.length === 0) return; // если всё ок — не показываем Notice (чтобы не шуметь)
    new Notice(`Ассистент: Linux Native — не хватает: ${missing.join(", ")} (найдено: ${found.join(", ") || "—"})`);
  }

  private async warnLinuxNativeDepsOnRecorderOpen(): Promise<void> {
    if (this.settings.recording.audioBackend !== "linux_native") return;
    try {
      await this.checkLinuxNativeRecordingDependencies();
    } catch (e) {
      // Не ломаем открытие окна диктофона из-за проверки; просто логируем.
      this.logService.warn("Linux Native: проверка зависимостей при открытии диктофона завершилась с ошибкой", {
        error: String((e as unknown) ?? "неизвестная ошибка"),
      });
    }
  }

  private applyRecordingMediaPermissions(): void {
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

        // Разрешаем только внутренним страницам Obsidian. Для внешних URL — запрещаем.
        if (!isInternal) {
          callback(false);
          return;
        }

        // `media` = микрофон/камера (в нашем случае аудио).
        // `display-capture` может всплывать в некоторых сборках Electron/Chromium при desktop audio capture.
        if (permission === "media" || permission === "display-capture") {
          callback(true);
          return;
        }

        // На всякий случай не ломаем возможные запросы от Obsidian (например, уведомления).
        if (permission === "notifications") {
          callback(true);
          return;
        }

        callback(false);
      });
      this.mediaPermissionsInstalled = true;
      // Не спамим Notice; достаточно переключателя в настройках.
    } catch {
      // ignore
    }
  }

  /**
   * Применить накопленные офлайн-изменения (outbox).
   *
   * Поддерживаем только изменение статуса участия (RSVP) в календаре (CalDAV).
   */
  async applyOutbox(): Promise<void> {
    const items = await this.outboxService.list();
    if (!items.length) {
      new Notice("Ассистент: очередь пуста");
      return;
    }

    const remaining: OutboxItemV1[] = [];
    let applied = 0;
    for (const it of items) {
      if (it.kind !== "set_event_partstat") {
        remaining.push(it);
        continue;
      }
      const calendarId = String(it.payload?.calendarId ?? "");
      const uid = String(it.payload?.uid ?? it.payload?.id ?? "");
      const startIso = String(it.payload?.start ?? "");
      const partstat = String(it.payload?.partstat ?? "");
      if (!calendarId || !uid || !startIso) {
        remaining.push(it);
        continue;
      }

      try {
        const d = new Date(startIso);
        if (Number.isNaN(d.getTime())) throw new Error("invalid start");
        if (partstat !== "accepted" && partstat !== "declined" && partstat !== "tentative" && partstat !== "needs_action") {
          throw new Error("invalid partstat");
        }
        const calendar: Calendar = {
          id: calendarId,
          name: "",
          type: "ics_url",
          config: ({ id: calendarId, name: "", type: "ics_url", enabled: true } as unknown) as any,
        };
        await this.calendarService.setMyPartstat({ calendar, id: uid, summary: "", start: d }, partstat);
        applied++;
      } catch (e) {
        this.logService.warn("Outbox: не удалось применить действие", { id: it.id, error: String((e as unknown) ?? "неизвестная ошибка") });
        remaining.push(it);
      }
    }

    await this.outboxService.replace(remaining);
    new Notice(`Ассистент: применено действий: ${applied}, осталось: ${remaining.length}`);
  }

  private async setActiveEventPartstat(partstat: "accepted" | "declined" | "tentative" | "needs_action"): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Ассистент: откройте заметку встречи");
      return;
    }
    try {
      const cur = await this.app.vault.read(file);
      const { frontmatter } = splitFrontmatter(cur);
      const fm = frontmatter ? parseFrontmatterMap(frontmatter) : {};
      if (fm["assistant_type"] !== "calendar_event") {
        new Notice("Ассистент: активный файл — не заметка встречи");
        return;
      }
      const calendarId = String(fm["calendar_id"] ?? "").trim();
      const uid = String(fm["event_id"] ?? "").trim();
      const startRaw = String(fm["start"] ?? "").trim();
      if (!calendarId || !uid || !startRaw) {
        new Notice("Ассистент: не найден calendar_id/event_id/start в frontmatter встречи");
        return;
      }
      const start = new Date(startRaw);
      if (Number.isNaN(start.getTime())) {
        new Notice("Ассистент: неверный формат start в frontmatter встречи");
        return;
      }
      const calendar: Calendar = {
        id: calendarId,
        name: "",
        type: "ics_url",
        config: ({ id: calendarId, name: "", type: "ics_url", enabled: true } as unknown) as any,
      };
      await this.calendarService.setMyPartstat({ calendar, id: uid, summary: "", start }, partstat);
      new Notice("Ассистент: статус обновлён в календаре");
    } catch (e) {
      // Если не можем применить сейчас (например нет сети) — кладём в outbox.
      const id = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter as Record<string, unknown> | undefined;
      const calendarId = String(fm?.calendar_id ?? "").trim();
      const uid = String((fm as any)?.event_id ?? "").trim();
      const start = String(fm?.start ?? "").trim();
      await this.outboxService.enqueue({
        id,
        createdAtMs: Date.now(),
        kind: "set_event_partstat",
        payload: { calendarId, uid, start, partstat },
      });
      this.logService.warn("Офлайн-режим: действие добавлено в очередь (не удалось применить к календарю)", {
        calendarId,
        uid,
        start,
        partstat,
        error: String((e as unknown) ?? "неизвестная ошибка"),
      });
      new Notice("Ассистент: не удалось применить. Действие добавлено в офлайн-очередь.");
    }
  }

  private async createPeopleCardsFromActiveMeeting(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Ассистент: откройте заметку встречи");
      return;
    }

    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter as Record<string, unknown> | undefined;
    const type = typeof fm?.assistant_type === "string" ? String(fm.assistant_type) : "";
    if (type !== "calendar_event") {
      new Notice("Ассистент: активный файл — не заметка встречи");
      return;
    }

    // Frontmatter attendees хранит person_id, а не emails.
    // Для создания карточек людей извлекаем emails из тела заметки.
    const text = await this.app.vault.read(file);
    const emails = Array.from(
      new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((x) => String(x ?? "").trim()).filter(Boolean)),
    );

    if (emails.length === 0) {
      new Notice("Ассистент: не удалось извлечь emails участников из тела заметки встречи");
      return;
    }

    let created = 0;
    let ensured = 0;
    for (const email of emails) {
      try {
        const before = this.personNoteService;
        void before;
        const existing = await this.personNoteService.ensureByEmail({ email });
        void existing;
        ensured++;
      } catch {
        // Если по какой-то причине ensureByEmail упал — не валим всю команду.
      }
    }

    // Пока не отличаем created/ensured (у нас нет явного флага), но это ок для MVP.
    created = 0;
    new Notice(`Ассистент: карточки людей обработаны: ${ensured}`);
  }

  private setupMeetingStatusAutoWriteBack(): void {
    // Debounced обработка изменённых md-файлов встреч.
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
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
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Ассистент: откройте заметку встречи");
      return;
    }
    await this.applyStatusFromMeetingFile(file, { silent: false });
  }

  private async applyStatusFromMeetingFile(file: TFile, opts: { silent: boolean }): Promise<void> {
    try {
      const cur = await this.app.vault.read(file);
      const { frontmatter } = splitFrontmatter(cur);
      const fm = frontmatter ? parseFrontmatterMap(frontmatter) : {};
      if (fm["assistant_type"] !== "calendar_event") return;

      const calendarId = String(fm["calendar_id"] ?? "").trim();
      const eventId = String(fm["event_id"] ?? "").trim();
      const startRaw = String(fm["start"] ?? "").trim();
      const status = String(fm["status"] ?? "").trim();

      if (!calendarId || !eventId || !startRaw) {
        if (!opts.silent) new Notice("Ассистент: не найден calendar_id/event_id/start в frontmatter встречи");
        return;
      }
      if (!status) {
        if (!opts.silent) new Notice("Ассистент: в заметке встречи не задан status");
        return;
      }
      if (status !== "accepted" && status !== "declined" && status !== "tentative" && status !== "needs_action") {
        if (!opts.silent) new Notice("Ассистент: неверный status (ожидали accepted/declined/tentative/needs_action)");
        return;
      }

      const start = new Date(startRaw);
      if (Number.isNaN(start.getTime())) {
        if (!opts.silent) new Notice("Ассистент: неверный формат start в заметке встречи");
        return;
      }

      const key = makeEventKey(calendarId, eventId);
      const storeEv = this.calendarService.getEventByEventKey(key);
      if (storeEv) {
        const myEmails = this.getMyEmailsForEvent(storeEv);
        if (myEmails.length && !this.hasMyAttendee(storeEv, myEmails)) {
          if (!opts.silent) new Notice("Ассистент: RSVP недоступен — ваш email не найден среди ATTENDEE этой встречи");
          return;
        }
      }
      const cached = this.recentlyAppliedMeetingStatusByEventKey.get(key);
      if (cached && cached.status === status && Date.now() - cached.atMs < 5_000) return;

      const inStore = this.calendarService.getEventByEventKey(key);
      if (inStore && inStore.status === status) return;

      const calendar: Calendar = {
        id: calendarId,
        name: "",
        type: "ics_url",
        config: ({ id: calendarId, name: "", type: "ics_url", enabled: true } as unknown) as any,
      };

      await this.calendarService.setMyPartstat({ calendar, id: eventId, summary: "", start }, status as any);
      await this.syncService.syncFromCurrentEvents(this.settings);
      this.recentlyAppliedMeetingStatusByEventKey.set(key, { status, atMs: Date.now() });

      if (!opts.silent) new Notice("Ассистент: статус применён в календарь и синхронизирован");
    } catch (e) {
      const msg = String((e as unknown) ?? "неизвестная ошибка");
      if (opts.silent) {
        this.logService.warn("RSVP: не удалось применить status из заметки встречи", { error: msg, file: file.path });
        return;
      }

      // Если не можем применить сейчас (например нет сети) — кладём в outbox.
      try {
        const cur = await this.app.vault.read(file);
        const { frontmatter } = splitFrontmatter(cur);
        const fm = frontmatter ? parseFrontmatterMap(frontmatter) : {};
        const calendarId = String(fm["calendar_id"] ?? "").trim();
        const uid = String(fm["event_id"] ?? "").trim();
        const start = String(fm["start"] ?? "").trim();
        const partstat = String(fm["status"] ?? "").trim();
        const id = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
        await this.outboxService.enqueue({ id, createdAtMs: Date.now(), kind: "set_event_partstat", payload: { calendarId, uid, start, partstat } });
        this.logService.warn("Офлайн-режим: статус из заметки добавлен в очередь", { calendarId, uid, start, partstat, error: msg });
        new Notice("Ассистент: не удалось применить. Действие добавлено в офлайн-очередь.");
      } catch {
        this.logService.warn("RSVP: не удалось применить status из заметки встречи (и не удалось положить в очередь)", { error: msg });
        new Notice(`Ассистент: не удалось применить статус: ${msg}`);
      }
    }
  }

  /** Создать “ручную” карточку встречи (без календаря) и открыть её. */
  private async createManualMeetingCard(): Promise<void> {
    const now = new Date();
    const uid = `manual-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
    const summary = `Встреча ${now.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })}`;

    const calendar: Calendar = {
      id: "manual",
      name: "Manual",
      type: "ics_url",
      config: ({ id: "manual", name: "Manual", type: "ics_url", enabled: true } as unknown) as any,
    };
    await this.eventNoteService.openEvent({
      calendar,
      id: uid,
      summary,
      start: now,
      end: new Date(now.getTime() + 60 * 60_000),
    });
  }

  /** Создать пустую карточку протокола (ручной старт) и открыть её. */
  private async createEmptyProtocolCard(): Promise<void> {
    const file = await this.protocolNoteService.createEmptyProtocol();
    await this.protocolNoteService.openProtocol(file);
  }

  /** Создать протокол из открытой карточки встречи (md) и открыть его. */
  private async createProtocolFromOpenMeeting(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Ассистент: откройте карточку встречи");
      return;
    }
    try {
      const protocol = await this.protocolNoteService.createProtocolFromMeetingFile(file);
      await this.protocolNoteService.openProtocol(protocol);
      // Связь протокол ↔ встреча
      const text = await this.app.vault.read(file);
      const { frontmatter } = splitFrontmatter(text);
      const fm = frontmatter ? parseFrontmatterMap(frontmatter) : {};
      const calendarId = String(fm["calendar_id"] ?? "manual");
      const id = String(fm["event_id"] ?? "");
      if (id) {
        await this.eventNoteService.linkProtocol(
          {
            calendar: {
              id: calendarId,
              name: "",
              type: "ics_url",
              config: ({ id: calendarId, name: "", type: "ics_url", enabled: true } as unknown) as any,
            },
            id,
            summary: String(fm["summary"] ?? file.basename ?? "Встреча"),
            start: fm["start"] ? new Date(String(fm["start"])) : new Date(),
            end: fm["end"] ? new Date(String(fm["end"])) : undefined,
          },
          protocol,
        );
      }
      this.logService.info("Создан протокол из открытой карточки встречи", { protocol: protocol.path, meeting: file.path });
    } catch (e) {
      const msg = String((e as unknown) ?? "неизвестная ошибка");
      this.logService.warn("Не удалось создать протокол из карточки встречи", { error: msg });
      new Notice(`Ассистент: не удалось создать протокол: ${msg}`);
    }
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
    return path.join(basePath, ".obsidian", "plugins", this.manifest.id);
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

  /**
   * Обновить ribbon-кнопки в зависимости от текущих настроек.
   * Важно: при выключенной отладке не показываем кнопку “Лог” на панели Obsidian.
   */
  private updateRibbonIcons(): void {
    const debugEnabled = this.settings.debug?.enabled === true;
    if (debugEnabled) {
      if (!this.logRibbonEl) {
        this.logRibbonEl = this.addRibbonIcon("list", "Ассистент: Лог", async () => this.activateLogView());
      }
      return;
    }

    if (this.logRibbonEl) {
      this.logRibbonEl.remove();
      this.logRibbonEl = undefined;
    }
  }

  async refreshCalendars() {
    try {
      await this.syncService.refreshCalendarsAndSync(this.settings);
      // eslint-disable-next-line no-empty
    } catch (e) {
      console.error("Ассистент: не удалось обновить календари", e);
      new Notice("Ассистент: не удалось обновить календари");
      this.logService.error("Обновление календарей: ошибка");
    }
  }

  async refreshCalendar(calendarId: string) {
    try {
      const { errors } = await this.calendarService.refreshOneAndMerge(calendarId);
      for (const e of errors) {
        this.logService.warn("Календарь: обновление (один): ошибка", { calendarId: e.calendarId, name: e.name, error: e.error });
      }
      await this.syncService.syncFromCurrentEvents(this.settings);
      if (errors.length === 0) this.logService.info("Календарь: обновление (один): ok", { calendarId });
      // eslint-disable-next-line no-empty
    } catch (e) {
      console.error("Ассистент: не удалось обновить календарь", e);
      new Notice("Ассистент: не удалось обновить календарь");
      this.logService.error("Календарь: обновление (один): ошибка");
    }
  }

  async createProtocolFromEvent(ev: Event): Promise<TFile> {
    const state = await this.getProtocolMenuState(ev);
    if (state.hasCurrent) {
      const infos = await this.eventNoteService.listProtocolInfos(ev);
      const current = infos.find((p) => p.start && sameLocalDate(p.start, ev.start)) ?? infos[0];
      if (!current) throw new Error("Нет протокола для открытия");
      await this.protocolNoteService.openProtocol(current.file);
      return current.file;
    }

    const eventFile = await this.eventNoteService.ensureEventFile(ev);
    const protocolFile = await this.protocolNoteService.createProtocolFromEvent(ev, eventFile.path);
    await this.protocolNoteService.openProtocol(protocolFile);
    await this.eventNoteService.linkProtocol(ev, protocolFile);
    this.logService.info("Создан новый протокол из встречи", { protocol: protocolFile.path });
    return protocolFile;
  }

  private async getProtocolMenuState(ev: Event): Promise<{ hasCurrent: boolean; hasLatest: boolean; currentIsLatest: boolean }> {
    const infos = await this.eventNoteService.listProtocolInfos(ev);
    if (infos.length === 0) return { hasCurrent: false, hasLatest: false, currentIsLatest: false };

    const latest = infos[0];
    const current = infos.find((p) => p.start && sameLocalDate(p.start, ev.start));
    const hasCurrent = Boolean(current);
    const hasLatest = true;
    const currentIsLatest = hasCurrent && current?.file.path === latest.file.path;
    return { hasCurrent, hasLatest, currentIsLatest };
  }

  private async openCurrentProtocolFromEvent(ev: Event) {
    const infos = await this.eventNoteService.listProtocolInfos(ev);
    const current = infos.find((p) => p.start && sameLocalDate(p.start, ev.start));
    if (!current) {
      new Notice("Ассистент: нет протокола на эту дату");
      return;
    }
    await this.protocolNoteService.openProtocol(current.file);
  }

  private async openLatestProtocolFromEvent(ev: Event) {
    const infos = await this.eventNoteService.listProtocolInfos(ev);
    if (infos.length === 0) {
      new Notice("Ассистент: у встречи пока нет протоколов");
      return;
    }
    await this.protocolNoteService.openProtocol(infos[0].file);
  }

  private async startRecordingFromReminder(ev: Event) {
    this.openRecordingDialog(ev);
  }

  private openRecordingDialog(preferredEvent?: Event) {
    // Ранний фидбек: если выбран Linux Native и не хватает зависимостей — покажем Notice сразу при открытии окна.
    // Если всё ок — молчим.
    void this.warnLinuxNativeDepsOnRecorderOpen();

    const now = new Date();
    const events = this.calendarService.getEvents();
    const preferredKey = preferredEvent ? makeEventKey(preferredEvent.calendar.id, preferredEvent.id) : undefined;
    const picked = preferredKey ? { selectedEventKey: preferredKey, createNewProtocol: true } : pickDefaultRecordingTarget(events, now, 5);

    const dlg = new RecordingDialog({
      settings: this.settings,
      events,
      protocols: this.listRecentProtocolsForDialog(120),
      defaultEventKey: picked.selectedEventKey,
      lockDefaultEvent: Boolean(preferredKey),
      // По умолчанию всегда создаём протокол (встречный или пустой), чтобы запись не терялась без контекста.
      defaultCreateNewProtocol: true,
      recordingService: this.recordingService,
      onCreateProtocol: async (ev) => {
        const f = await this.createProtocolFromEvent(ev);
        return f.path;
      },
      onCreateEmptyProtocol: async () => {
        const file = await this.protocolNoteService.createEmptyProtocol();
        await this.protocolNoteService.openProtocol(file);
        return file.path;
      },
      onOpenProtocol: async (protocolFilePath) => {
        const af = this.app.vault.getAbstractFileByPath(String(protocolFilePath || ""));
        if (!af || !isTFile(af)) {
          new Notice("Ассистент: протокол не найден (проверьте путь)");
          return;
        }
        await this.protocolNoteService.openProtocol(af);
      },
      onLog: (m) => this.logService.info(m),
    });

    try {
      dlg.open();
    } catch (e) {
      const msg = String((e as unknown) ?? "неизвестная ошибка");
      this.logService.error("Запись: не удалось открыть диалог", { error: msg });
      new Notice("Ассистент: не удалось открыть диалог записи");
    }
  }

  /** Для диалога диктофона: берём последние протоколы из папки протоколов (по mtime). */
  private listRecentProtocolsForDialog(limit: number): Array<{ path: string; label: string }> {
    const dir = String(this.settings?.folders?.protocols ?? "").replace(/\/+$/g, "");
    const files = this.app.vault.getMarkdownFiles().filter((f) => String(f.path || "").startsWith(dir ? `${dir}/` : ""));

    // Фильтрация по frontmatter assistant_type: protocol (если метаданные есть)
    const protocols = files.filter((f) => {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter as any;
      const t = String(fm?.assistant_type ?? "");
      return t ? t === "protocol" : true;
    });

    protocols.sort((a, b) => {
      const am = Number((a as any)?.stat?.mtime ?? 0);
      const bm = Number((b as any)?.stat?.mtime ?? 0);
      return bm - am;
    });

    return protocols.slice(0, Math.max(1, Math.floor(limit || 50))).map((f) => ({ path: f.path, label: f.basename }));
  }

  private async meetingCancelledFromReminder(ev: Event) {
    await this.eventNoteService.markCancelled(ev);
    await this.eventNoteService.openEvent(ev);
    this.logService.warn("Встреча помечена как отменена", { meeting: ev.summary, id: ev.id, calendarId: ev.calendar.id });
  }

  private debugShowReminder(ev: Event) {
    if (!this.settings.debug.enabled) {
      new Notice("Ассистент: включите «Отладка» в настройках");
      return;
    }
    this.notificationScheduler.debugShowReminder(ev);
  }

  private async createProtocolFromActiveEvent() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Ассистент: нет активного файла");
      return;
    }

    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (!fm || fm.assistant_type !== "calendar_event") {
      new Notice("Ассистент: открой файл встречи (assistant_type: calendar_event)");
      return;
    }

    const calendarId = String(fm.calendar_id ?? "");
    const uid = String((fm as any).event_id ?? "");
    const summary = String(fm.summary ?? file.basename);
    const startIso = String(fm.start ?? "");
    const endIso = String(fm.end ?? "");
    if (!calendarId || !uid || !startIso) {
      new Notice("Ассистент: во встрече не хватает calendar_id/event_id/start");
      return;
    }

    const calendar: Calendar = {
      id: calendarId,
      name: "",
      type: "ics_url",
      config: ({ id: calendarId, name: "", type: "ics_url", enabled: true } as unknown) as any,
    };
    await this.createProtocolFromEvent({ calendar, id: uid, summary, start: new Date(startIso), end: endIso ? new Date(endIso) : undefined });
  }

  async activateAgendaView() {
    const existing = this.app.workspace.getLeavesOfType(AGENDA_VIEW_TYPE);
    const leaf = existing[0] ?? this.app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: AGENDA_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async activateLogView() {
    const existing = this.app.workspace.getLeavesOfType(LOG_VIEW_TYPE);
    const leaf = existing[0] ?? this.app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: LOG_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  private setupAutoRefreshTimer() {
    if (this.refreshTimer) window.clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;

    if (!this.settings.calendar.autoRefreshEnabled) {
      this.logService.info("Автообновление: выключено");
      return;
    }

    const minutes = Math.max(1, this.settings.calendar.autoRefreshMinutes);
    const intervalMs = minutes * 60_000;
    this.logService.info("Автообновление: включено", { minutes });

    this.refreshTimer = window.setInterval(() => {
      void this.refreshCalendars();
    }, intervalMs);
  }
}

function sameLocalDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
