import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { CalendarService } from "./src/calendar/calendarService";
import { EventNoteService } from "./src/calendar/eventNoteService";
import { LogFileWriter } from "./src/log/logFileWriter";
import { LogService } from "./src/log/logService";
import { NotificationScheduler } from "./src/notifications/notificationScheduler";
import { DEFAULT_SETTINGS, normalizeSettings } from "./src/settingsStore";
import type { AssistantSettings, CalendarEvent } from "./src/types";
import { AssistantSettingsTab } from "./src/ui/settingsTab";
import { ensureFolder } from "./src/vault/ensureFolder";
import { AgendaView, AGENDA_VIEW_TYPE } from "./src/views/agendaView";
import { LOG_VIEW_TYPE, LogView } from "./src/views/logView";
import { SyncService } from "./src/sync/syncService";
import { ProtocolNoteService } from "./src/protocols/protocolNoteService";
import { commandExists } from "./src/os/commandExists";
import { runGoogleLoopbackOAuth } from "./src/caldav/googleOauth";
import * as path from "node:path";
import { IndexNoteService } from "./src/index/indexNoteService";
import { CalendarEventCache } from "./src/calendar/store/calendarEventCache";
import { OutboxService } from "./src/offline/outboxService";
import type { OutboxItemV1 } from "./src/offline/outboxService";
import { isTFile } from "./src/vault/ensureFile";
import { parseFrontmatterMap, splitFrontmatter, upsertFrontmatter } from "./src/vault/frontmatter";

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
  indexNoteService!: IndexNoteService;
  calendarEventCache!: CalendarEventCache;
  outboxService!: OutboxService;
  logFileWriter!: LogFileWriter;
  logService!: LogService;
  notificationScheduler!: NotificationScheduler;
  syncService!: SyncService;
  private refreshTimer?: number;
  private initStarted = false;
  private agendaRibbonEl?: HTMLElement;
  private logRibbonEl?: HTMLElement;

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
    this.calendarService = new CalendarService(this.settings);
    this.eventNoteService = new EventNoteService(this.app, this.settings.folders.calendarEvents);
    this.protocolNoteService = new ProtocolNoteService(this.app, this.settings.folders.protocols);
    this.indexNoteService = new IndexNoteService(this.app, {
      indexDir: this.settings.folders.index,
      eventsDir: this.settings.folders.calendarEvents,
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
    this.syncService = new SyncService(this.calendarService, this.eventNoteService, this.notificationScheduler, this.logService);

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
          (ev) => this.getProtocolMenuState(ev),
          (ev) => void this.openCurrentProtocolFromEvent(ev),
          (ev) => void this.openLatestProtocolFromEvent(ev),
          (ev) => void this.createProtocolFromEvent(ev),
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
    // Кнопку “Лог” показываем только в debug-режиме (см. updateRibbonIcons()).
    this.updateRibbonIcons();

    this.addCommand({
      id: "open-agenda",
      name: "Открыть повестку",
      callback: () => this.activateAgendaView(),
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
      id: "apply-outbox",
      name: "Применить офлайн-очередь",
      callback: () => void this.applyOutbox(),
    });

    this.addCommand({
      id: "event-plan-accepted",
      name: "Отметить «Приду» (в заметке встречи)",
      callback: () => void this.setActiveEventPlanPartstat("accepted"),
    });
    this.addCommand({
      id: "event-plan-declined",
      name: "Отметить «Не приду» (в заметке встречи)",
      callback: () => void this.setActiveEventPlanPartstat("declined"),
    });
    this.addCommand({
      id: "event-plan-tentative",
      name: "Отметить «Возможно» (в заметке встречи)",
      callback: () => void this.setActiveEventPlanPartstat("tentative"),
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
    this.protocolNoteService.setProtocolsDir(this.settings.folders.protocols);
    this.indexNoteService.setPaths({
      indexDir: this.settings.folders.index,
      eventsDir: this.settings.folders.calendarEvents,
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
      await ensureFolder(this.app.vault, this.settings.folders.index);
      await this.indexNoteService.ensureIndexNotes();
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
      });
    });

    await this.refreshCalendars();
    this.setupAutoRefreshTimer();
  }

  async saveSettingsAndApply() {
    await this.saveData(this.settings);
    this.logService.setMaxEntries(this.settings.log.maxEntries);
    await this.logFileWriter.setRetentionDays(this.settings.log.retentionDays);
    // Лог-файлы пишем вне vault (в папку плагина). Конфиг папки/включения не настраивается.
    this.syncService.applySettings(this.settings);
    this.protocolNoteService.setProtocolsDir(this.settings.folders.protocols);
    this.indexNoteService.setPaths({
      indexDir: this.settings.folders.index,
      eventsDir: this.settings.folders.calendarEvents,
      protocolsDir: this.settings.folders.protocols,
      peopleDir: this.settings.folders.people,
      projectsDir: this.settings.folders.projects,
    });

    // Обновляем уже открытые views повестки
    for (const leaf of this.app.workspace.getLeavesOfType(AGENDA_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof AgendaView) view.setSettings(this.settings);
    }

    // Перепланируем уведомления по текущим событиям
    this.notificationScheduler.schedule(this.calendarService.getEvents());

    this.setupAutoRefreshTimer();
    this.updateRibbonIcons();
  }

  /**
   * Применить накопленные офлайн-изменения (outbox).
   *
   * MVP: поддерживаем только локальную метку в заметке встречи (frontmatter `my_plan_partstat`).
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
      if (it.kind !== "set_event_plan_partstat") {
        remaining.push(it);
        continue;
      }
      const filePath = String(it.payload?.filePath ?? "");
      const partstat = String(it.payload?.partstat ?? "");
      if (!filePath || !partstat) {
        remaining.push(it);
        continue;
      }

      const af = this.app.vault.getAbstractFileByPath(filePath);
      if (!af || !isTFile(af)) {
        remaining.push(it);
        continue;
      }

      try {
        const cur = await this.app.vault.read(af);
        const { frontmatter } = splitFrontmatter(cur);
        const fm = frontmatter ? parseFrontmatterMap(frontmatter) : {};
        if (fm["assistant_type"] !== "calendar_event") {
          remaining.push(it);
          continue;
        }
        const updated = upsertFrontmatter(cur, { my_plan_partstat: partstat });
        await this.app.vault.modify(af, updated);
        applied++;
      } catch (e) {
        this.logService.warn("Outbox: не удалось применить действие", { id: it.id, error: String((e as unknown) ?? "неизвестная ошибка") });
        remaining.push(it);
      }
    }

    await this.outboxService.replace(remaining);
    new Notice(`Ассистент: применено действий: ${applied}, осталось: ${remaining.length}`);
  }

  private async setActiveEventPlanPartstat(partstat: "accepted" | "declined" | "tentative"): Promise<void> {
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
      const updated = upsertFrontmatter(cur, { my_plan_partstat: partstat });
      await this.app.vault.modify(file, updated);
      new Notice("Ассистент: сохранено в заметке встречи");
    } catch (e) {
      // Если не можем записать в vault — кладём в outbox.
      const id = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
      await this.outboxService.enqueue({
        id,
        createdAtMs: Date.now(),
        kind: "set_event_plan_partstat",
        payload: { filePath: file.path, partstat },
      });
      this.logService.warn("Офлайн-режим: действие добавлено в очередь (не удалось записать в vault)", {
        filePath: file.path,
        partstat,
        error: String((e as unknown) ?? "неизвестная ошибка"),
      });
      new Notice("Ассистент: не удалось записать. Действие добавлено в офлайн-очередь.");
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

  async debugNotifyTest() {
    // Только для ручной проверки из настроек
    this.notificationScheduler.debugShowReminder({
      calendarId: "debug",
      uid: "debug",
      summary: "Тестовое напоминание",
      start: new Date(Date.now() + 5 * 60_000),
      end: new Date(Date.now() + 35 * 60_000),
    });
  }

  async checkNotificationDependencies(): Promise<{ ok: boolean; message: string }> {
    const method = this.settings.notifications.delivery.method;
    const isLinux = process.platform === "linux";

    if (method === "obsidian_notice") {
      return { ok: true, message: "OK: для Notice внутри Obsidian зависимости не нужны." };
    }

    if (!isLinux) {
      return { ok: false, message: "Ошибка: выбранный способ уведомлений поддержан только на Linux." };
    }

    if (method === "system_notify_send") {
      const ok = await commandExists("notify-send");
      return ok
        ? { ok: true, message: "OK: найден notify-send." }
        : { ok: false, message: "Не найден notify-send. Установите: sudo apt install libnotify-bin" };
    }

    if (method === "popup_window") {
      const ok = await commandExists("yad");
      return ok ? { ok: true, message: "OK: найден yad." } : { ok: false, message: "Не найден yad. Установите: sudo apt install yad" };
    }

    return { ok: false, message: "Ошибка: неизвестный способ уведомлений." };
  }

  async createProtocolFromEvent(ev: CalendarEvent) {
    const state = await this.getProtocolMenuState(ev);
    if (state.hasCurrent) {
      await this.openCurrentProtocolFromEvent(ev);
      return;
    }

    const eventFile = await this.eventNoteService.ensureEventFile(ev);
    const protocolFile = await this.protocolNoteService.createProtocolFromEvent(ev, eventFile.path);
    await this.protocolNoteService.openProtocol(protocolFile);
    await this.eventNoteService.linkProtocol(ev, protocolFile);
    this.logService.info("Создан новый протокол из встречи", { protocol: protocolFile.path });
  }

  private async getProtocolMenuState(ev: CalendarEvent): Promise<{ hasCurrent: boolean; hasLatest: boolean; currentIsLatest: boolean }> {
    const infos = await this.eventNoteService.listProtocolInfos(ev);
    if (infos.length === 0) return { hasCurrent: false, hasLatest: false, currentIsLatest: false };

    const latest = infos[0];
    const current = infos.find((p) => p.start && sameLocalDate(p.start, ev.start));
    const hasCurrent = Boolean(current);
    const hasLatest = true;
    const currentIsLatest = hasCurrent && current?.file.path === latest.file.path;
    return { hasCurrent, hasLatest, currentIsLatest };
  }

  private async openCurrentProtocolFromEvent(ev: CalendarEvent) {
    const infos = await this.eventNoteService.listProtocolInfos(ev);
    const current = infos.find((p) => p.start && sameLocalDate(p.start, ev.start));
    if (!current) {
      new Notice("Ассистент: нет протокола на эту дату");
      return;
    }
    await this.protocolNoteService.openProtocol(current.file);
  }

  private async openLatestProtocolFromEvent(ev: CalendarEvent) {
    const infos = await this.eventNoteService.listProtocolInfos(ev);
    if (infos.length === 0) {
      new Notice("Ассистент: у встречи пока нет протоколов");
      return;
    }
    await this.protocolNoteService.openProtocol(infos[0].file);
  }

  private async startRecordingFromReminder(ev: CalendarEvent) {
    // MVP: пока только логируем. Дальше сюда подключим helper-сервис/диктофон.
    this.logService.info("Запись: start (MVP stub)", { event: ev.summary, uid: ev.uid, calendarId: ev.calendarId });
    new Notice("Ассистент: запись (пока заглушка)");
  }

  private async meetingCancelledFromReminder(ev: CalendarEvent) {
    await this.eventNoteService.markCancelled(ev);
    await this.eventNoteService.openEvent(ev);
    this.logService.warn("Встреча помечена как отменена", { meeting: ev.summary, uid: ev.uid, calendarId: ev.calendarId });
  }

  private debugShowReminder(ev: CalendarEvent) {
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
    const uid = String(fm.uid ?? "");
    const summary = String(fm.summary ?? file.basename);
    const startIso = String(fm.start ?? "");
    const endIso = String(fm.end ?? "");
    if (!calendarId || !uid || !startIso) {
      new Notice("Ассистент: во встрече не хватает calendar_id/uid/start");
      return;
    }

    const ev = {
      calendarId,
      uid,
      summary,
      start: new Date(startIso),
      end: endIso ? new Date(endIso) : undefined,
    };
    await this.createProtocolFromEvent(ev);
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
