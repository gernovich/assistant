# Рефакторинг архитектуры плагина “Ассистент” (Obsidian, TypeScript)

Документ: **анализ текущего состояния + целевая архитектура + контракты + пошаговый план модернизации**.  
Ограничение: **в этом цикле мы ничего не рефакторим**, только фиксируем план.

---

## 1) Фаза сбора информации (что есть сейчас)

### 1.1. Структура проекта (основные папки/файлы)

- **Entry point / wiring**
  - `main.ts`: основной класс `AssistantPlugin` (инициализация, сборка сервисов, команды, views, таймеры, интеграции).
  - `dist/main.js`: билд-артефакт для Obsidian (генерируется сборкой).
  - `resources/*`: исходные статические файлы (например `manifest.json`, `styles.css`), которые копируются в `dist/`.
- **Документация / контракты данных**
  - `README.md`: назначение, сборка, установка, CalDAV/ICS, команды, диктофон.
  - `TZ.md`: фактически архитектурное ТЗ + функциональные требования и заметки по evolution.
  - `FIELDS.md`: **контракт frontmatter/DTO** для встреч/протоколов/людей/проектов + карты полей ICS/CalDAV.
  - `TESTING.md`: ручные тесты + советы по remote debugging.
  - `REVIEW.md`: ревью состояния, сильные стороны/риски.
  - `INDECATOR.md`: эволюция индикатора записи (важно для диктофона).
- **Исходники**
  - `src/calendar/*`: календарь (ICS/CalDAV providers, store/cache, синхронизация событий в memory).
  - `src/caldav/*`: транспорт/адаптеры под Obsidian (fetch/requestUrl), Google OAuth loopback.
  - `src/notifications/*`: планировщик уведомлений + electron_window (BrowserWindow).
  - `src/recording/*`: диктофон (UI окно + сервис записи, Linux native ffmpeg backend).
  - `src/vault/*`: инфраструктура работы с vault (ensure*, frontmatter, секции markdown, naming, reveal/open).
  - `src/views/*`: Obsidian views (`agendaView.ts`, `logView.ts`).
  - `src/ui/*`: settings tab + секции UI.
  - `src/log/*`: in-memory лог + запись в лог-файлы + redaction.
  - `src/offline/*`: outbox (очередь офлайн-изменений RSVP).
  - `src/people/*`, `src/projects/*`, `src/protocols/*`: note services сущностей.
  - `src/ids/*`: стабильные id (eventKey, personId, shortStableId).
  - `src/types.ts`: ядро типов/DTO (Settings, Calendar, Event, Person/Project/Protocol и т.д.).
- **Тесты**
  - `tests/*`: Vitest (много юнит-тестов на календарь/хранилище/уведомления/логирование/инфраструктуру).

### 1.2. Основные функции приложения (что делает плагин)

- **Календарь**
  - Подключение календарей: `ICS URL` и `CalDAV` (включая Google OAuth для CalDAV).
  - Refresh календарей (получение событий) + offline-first (stale/last-good).
  - RSVP write-back для CalDAV (из повестки и из заметки встречи через изменение `status:`).
- **UI**
  - View “Повестка” (`AgendaView`): дневная сетка, контекстное меню (перейти, RSVP, протоколы, диктофон).
  - View “Лог” (`LogView`): просмотр in-memory лога + операции с лог-файлом.
  - Settings UI: секции (календари, CalDAV аккаунты, уведомления, диктофон, папки vault, outbox, debug).
- **Vault (Obsidian)**
  - Создание/обновление карточек:
    - встречи: `Ассистент/Встречи/` (`assistant_type: calendar_event`)
    - протоколы: `Ассистент/Протоколы/` (`assistant_type: protocol`)
    - люди: `Ассистент/Люди/` (`assistant_type: person`)
    - проекты: `Ассистент/Проекты/` (`assistant_type: project`)
  - Связи “встреча ↔ протоколы” через секцию `ASSISTANT:PROTOCOLS`.
  - Генерация `.base` файлов для Obsidian Bases.
- **Уведомления**
  - Планирование (setTimeout) “за N минут” и “в момент начала”.
  - Доставка: **electron_window** (BrowserWindow, alwaysOnTop) + fallback на `Notice` в окружениях без BrowserWindow.
- **Запись (диктофон)**
  - Окно диктофона (BrowserWindow).
  - Запись чанками, пауза/продолжить, прикрепление файлов к протоколу (`files:`).
  - Linux native backend через `ffmpeg` + зависимость от `pactl` и системы (PulseAudio/PipeWire-Pulse).
  - Индикатор уровня/визуализация (см. `INDECATOR.md`).
- **Логирование**
  - `LogService`: in-memory + запись на диск через `LogFileWriter` (в `<vault>/.obsidian/plugins/assistant/logs`).
  - Redaction секретов (см. `src/log/redact.ts`).

### 1.3. Коммуникация между процессами (Main ↔ Renderer)

Важная оговорка: это **не отдельное Electron-приложение**, а **плагин Obsidian**.

- **Основной runtime плагина**: Obsidian renderer-процесс (где выполняется код плагина).
- **Доп. окна**: создаются через `BrowserWindow` (Electron), это отдельные renderer-процессы.
- **Текущий “IPC”** (фактически, не IPC Electron):
  - **Action из окна → плагин**:
    - в `src/notifications/electronWindowReminder.ts`: кнопки ставят `document.title='assistant-action:...'`, а снаружи слушаем `win.webContents.on("page-title-updated", ...)`.
    - в диктофоне (`src/recording/recordingDialog.ts`) используется аналогичная схема (action-коды в title).
  - **Плагин → окно**:
    - `webContents.executeJavaScript("window.__assistantRecordingUpdate(...)")` и `...VizUpdate(...)` для проталкивания stats/viz.

Вывод: **централизованного IPC слоя нет**, каналы не типизированы, нет request/response, нет общей модели ошибок и таймаутов.

### 1.4. Внешние зависимости (БД, API, нативные модули)

- **БД**: нет. Хранилище данных:
  - Obsidian `saveData/loadData` (настройки в `.obsidian/plugins/assistant/data.json`).
  - Vault markdown файлы (карточки).
  - Системная директория плагина (кэш/индексы/outbox/логи).
- **API / протоколы**
  - **ICS**: загрузка по URL, парсинг/нормализация.
  - **CalDAV**: через `tsdav` (discovery + time-range запросы) + write-back RSVP.
  - **Google OAuth loopback**: callback на `127.0.0.1` для получения `refresh_token` (CalDAV).
- **Нативные зависимости (Linux)**
  - `ffmpeg`, `pactl` (обязательные для Linux native записи), опционально `pw-record`, `parec`.
- **Node/Electron**
  - `require("electron")` в местах, где нужен `BrowserWindow`/`shell`/`session`.
  - `child_process` для процессов (ffmpeg).
- **npm зависимости (по `package.json`)**
  - `tsdav`, `fix-webm-duration`.
  - dev: `obsidian`, `esbuild`, `vitest`, `typescript`, `prettier`.

### 1.5. Документация/комментарии к архитектуре

Есть и это плюс:
- `TZ.md` и `FIELDS.md` — уже почти “архитектурный контракт”.
- `REVIEW.md` — фиксация зрелости и рисков.
- В коде присутствуют TSDoc/комментарии в ключевых местах (например `main.ts`, `SyncService`, `NotificationScheduler`).

---

## 2) Фаза анализа текущей архитектуры

### 2.1. Запахи кода (smells)

- **God class / “божественный объект”**
  - `main.ts` (`AssistantPlugin`): одновременно composition root (wiring), UI команды/views, бизнес-логика (RSVP правила), инфраструктура (пути к директориям плагина), outbox, OAuth, автосинк заметок, таймеры.
- **Божественный сервис**
  - `src/recording/recordingService.ts`: два backend’а записи, процессы, fs, чанкинг, виз-метрики, прикрепление к протоколу, “статистика”, логирование — всё в одном.
  - `src/recording/recordingDialog.ts`: огромный HTML/JS state machine + протокол действий + “IPC” + визуализация.
- **Сильная связанность слоёв**
  - Views/UI получают “коллбеки” из `main.ts`, а `main.ts` напрямую дергает инфраструктуру и сервисы.
  - `CalendarService` сам создаёт providers (`IcsUrlProvider`, `CaldavProvider`) → нарушение DIP (сложно подменять в тестах/при расширении).
- **Неформализованный IPC**
  - `document.title` как транспорт команд + `executeJavaScript` для пуша стейта → нет типизации, нет схемы сообщений, нет ошибок/ack.
- **Дублирование**
  - Повторяется код “создать BrowserWindow + стили/HTML + обработка действий” между напоминанием и диктофоном.
  - Повторяются модели “action string → parse → выполнить → close”.
- **Смешение concerns**
  - Доменные сущности (Event/Protocol) смешаны с Obsidian API (TFile/Vault) внутри “сервисов сущностей”.
  - Валидация входных данных/настроек частично размазана по месту использования.

### 2.2. SOLID / SoC / DRY

- **SRP нарушается**
  - `AssistantPlugin`, `RecordingService`, `RecordingDialog` делают слишком много.
- **DIP нарушается**
  - Прямые `new` провайдеров/адаптеров внутри сервисов (пример: `CalendarService`).
  - Транспорт (electron window) и бизнес-логика действий связаны напрямую (actions коллбеки).
- **OCP частично нарушается**
  - Добавление нового calendar source требует правок в нескольких местах (settings → provider → CalendarService → UI).
- **Separation of Concerns**
  - Presentation (UI) и Application (use-cases) пока не отделены; “оркестрация” частично в `main.ts`, частично в `SyncService`.
- **DRY**
  - Есть повторяющиеся паттерны (BrowserWindow scaffolding, action routing, escaping HTML).

### 2.3. TypeScript/типизация

Плюсы:
- `tsconfig.json`: `strict: true`, `noImplicitAny: true` — это хороший базовый уровень.
- `src/types.ts` уже содержит богатые DTO и контракты.

Минусы/риски:
- Точечные `any`/`as any` используются для стыков:
  - Electron / Obsidian API / внешние либы (`fix-webm-duration`, `metadataCache`, `crypto`).
- Нет централизованной runtime-валидации DTO (особенно для сообщений “IPC” и данных, приходящих извне).

### 2.4. IPC/межоконная коммуникация (Inter-Process)

Текущее состояние:
- **Каналы не централизованы** (разрозненные строки действий).
- **Нет типизированного реестра каналов**.
- **Нет формата request/response**, нет корреляции по id, нет таймаутов/повторов.
- **Ошибки**: в основном try/catch без унифицированных error-кодов.

Риск:
- при росте числа действий/окон это станет основным источником регрессий и “магических строк”.

### 2.5. Границы модулей (логические домены)

Фактические домены уже читаются в структуре `src/`:
- **Calendar domain**: `src/calendar/*`, `src/caldav/*`
- **Vault domain**: `src/vault/*` + note services (`src/*/*NoteService.ts`)
- **Notifications domain**: `src/notifications/*`
- **Recording domain**: `src/recording/*`
- **Cross-cutting**: `src/log/*`, `src/offline/*`, `src/ids/*`, `src/settingsStore.ts`

Проблема: домены существуют, но **слои** (presentation/application/domain/infrastructure) сейчас перемешаны.

---

## 3) Целевая архитектура (слоистая) + миграция модулей

### 3.1. Схема слоёв (целевой вид)

```
┌────────────────────────────────────────────────────────────┐
│ Presentation                                                │
│  - Obsidian Views (Agenda/Log)                              │
│  - Settings UI                                              │
│  - Electron Windows (Reminder/Recording)                    │
│  - Commands / user interactions                             │
└───────────────▲───────────────────────────────┬────────────┘
                │ calls use-cases               │ typed window bridge
┌───────────────┴───────────────────────────────▼────────────┐
│ Application                                                 │
│  - UseCases: RefreshCalendars, SyncNotes, ScheduleNotifs     │
│  - UseCases: SetRsvp, ApplyOutbox                            │
│  - UseCases: Start/Stop/Pause/Resume Recording               │
│  - UseCases: CalDAV discovery + Google OAuth                 │
│  - Orchestration, policies, transactions                     │
└───────────────▲───────────────────────────────┬────────────┘
                │ uses interfaces               │ returns DTO/Result
┌───────────────┴───────────────────────────────▼────────────┐
│ Domain                                                      │
│  - Entities/VO: Event, Occurrence, Calendar, Protocol        │
│  - Policies: event identity, RSVP rules, naming rules        │
│  - Errors: domain/app error codes                            │
└───────────────▲───────────────────────────────┬────────────┘
                │ implemented by                │
┌───────────────┴───────────────────────────────▼────────────┐
│ Infrastructure                                              │
│  - Calendar providers: ICS, CalDAV (tsdav)                   │
│  - Vault repos: meeting/protocol/person/project notes        │
│  - Cache/Index repos: calendar cache, event-note index       │
│  - Outbox repo                                               │
│  - Recording backends: electron(MediaRecorder), linux(ffmpeg)│
│  - ElectronWindowAdapter + WindowBridge transport            │
│  - Logging sinks (file writer)                               │
└────────────────────────────────────────────────────────────┘
```

### 3.2. Куда “переезжают” текущие модули (mapping)

- **Presentation**
  - `src/views/*` → `src/presentation/obsidian/views/*`
  - `src/ui/*` → `src/presentation/obsidian/settings/*`
  - `src/notifications/electronWindowReminder.ts` → `src/presentation/electronWindow/reminder/*`
  - `src/recording/recordingDialog.ts` → `src/presentation/electronWindow/recording/*`
  - команды/меню/обработчики: из `main.ts` → `src/presentation/obsidian/commands/*`
- **Application**
  - `src/sync/syncService.ts` → `src/application/usecases/RefreshAndSyncCalendars.ts` (или набор use-cases)
  - RSVP/outbox (часть `main.ts`) → `src/application/usecases/SetRsvpStatus.ts`, `ApplyOutbox.ts`
  - `authorizeGoogleCaldav` (из `main.ts`) → `src/application/usecases/AuthorizeGoogleOAuth.ts`
  - “open protocol from event”, “create protocol” и т.п. → use-cases
- **Domain**
  - DTO/сущности в `src/types.ts` разделить на:
    - `src/domain/*` (сущности/VO/инварианты)
    - `src/shared/contracts/*` (DTO для UI/transport)
  - Логика ключей: `src/ids/*` → `src/domain/identity/*`
- **Infrastructure**
  - `src/calendar/providers/*` → `src/infrastructure/calendar/*`
  - `src/vault/*` + note services → `src/infrastructure/obsidianVault/*`
  - `src/log/*` (file writer, redact) → `src/infrastructure/logging/*` + `src/shared/logging/*`
  - `src/offline/outboxService.ts` → `src/infrastructure/offline/*`
  - `src/recording/recordingService.ts` разделить на:
    - application orchestrator + `RecordingBackend` интерфейс
    - infra: `ElectronMediaRecorderBackend`, `LinuxFfmpegBackend`

---

## 4) Контракты между слоями (DTO / интерфейсы / IPC / ошибки / логирование)

Ниже — **целевые** контракты (проектируем), которые можно внедрять инкрементально (с адаптерами поверх текущей реализации).

### 4.1. Общие ошибки и Result

Цель: перестать прокидывать “строки ошибок” как `string`, вместо этого стандартизировать.

```ts
export type ErrorCode =
  | "E_VALIDATION"
  | "E_NETWORK"
  | "E_CALDAV_AUTH"
  | "E_CALDAV_DISCOVERY"
  | "E_CALDAV_WRITEBACK"
  | "E_ICS_FETCH"
  | "E_VAULT_IO"
  | "E_FS_IO"
  | "E_RECORDING_BACKEND"
  | "E_ELECTRON_UNAVAILABLE"
  | "E_TIMEOUT"
  | "E_INTERNAL";

export type AppErrorDto = {
  code: ErrorCode;
  message: string;          // безопасное для UI
  cause?: string;           // безопасное для логов (redacted)
  details?: Record<string, unknown>;
};

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppErrorDto };
```

### 4.2. DTO для IPC/окон (Reminder/Recording)

Сейчас transport = `document.title` / `executeJavaScript`. Целевой контракт должен быть независим от транспорта.

```ts
export type IpcChannel =
  | "assistant/window/ready"
  | "assistant/window/action"
  | "assistant/recording/stats"
  | "assistant/recording/viz";

export type IpcEnvelope<T extends string, P> = {
  id: string;               // correlation id
  channel: T;
  ts: number;
  payload: P;
};

// Actions из окна в приложение
export type WindowAction =
  | { kind: "close" }
  | { kind: "reminder.startRecording"; eventKey: string }
  | { kind: "reminder.meetingCancelled"; eventKey: string }
  | { kind: "recording.start"; mode: "manual_new" | "occurrence_new" | "meeting_new" | "continue_protocol"; payload: Record<string, unknown> }
  | { kind: "recording.pause" }
  | { kind: "recording.resume" }
  | { kind: "recording.stop" };

export type WindowActionEvent = IpcEnvelope<"assistant/window/action", WindowAction>;

// Push из приложения в окно
export type RecordingStatsDto = {
  status: "idle" | "recording" | "paused";
  startedAtMs?: number;
  elapsedMs?: number;
  filesTotal: number;
  filesRecognized: number;
  nextChunkInMs?: number;
  eventKey?: string;
  protocolFilePath?: string;
};

export type RecordingStatsEvent = IpcEnvelope<"assistant/recording/stats", RecordingStatsDto>;
export type RecordingVizEvent = IpcEnvelope<"assistant/recording/viz", { amp01: number }>;
```

**Стратегия ошибок для IPC**:
- transport должен уметь доставить `{ ok:false, error }` как ответ на запрос (или хотя бы логировать и закрывать окно).
- обязательные элементы: `id`, `channel`, `ts`.
- таймауты на ожидание “ready” окна.

### 4.3. DTO для календаря / sync / notes (уровень Application)

В проекте уже есть хорошие DTO в `src/types.ts`. Цель рефакторинга — разделить:
- domain-структуры (инварианты),
- persisted-настройки,
- transport DTO (для UI/IPC).

Минимальный набор DTO, который должен быть стабилен:
- `CalendarConfigDto`, `CaldavAccountConfigDto` (persisted)
- `CalendarDto`, `EventDto`, `OccurrenceDto` (runtime normalized)
- `MeetingNoteDto`, `ProtocolNoteDto`, `PersonNoteDto`, `ProjectNoteDto` (vault contracts — см. `FIELDS.md`)

### 4.4. Интерфейсы репозиториев (Infrastructure boundary)

```ts
export interface CalendarProvider {
  kind: "ics_url" | "caldav";
  refresh(calendar: CalendarConfig): Promise<Result<Event[]>>;
}

export interface RsvpWriter {
  setMyPartstat(params: { calendar: CalendarConfig; event: Event; partstat: "accepted" | "declined" | "tentative" | "needs_action" }): Promise<Result<void>>;
}

export interface MeetingNoteRepository {
  ensure(event: Event): Promise<Result<{ path: string }>>;
  upsertFromEvent(event: Event): Promise<Result<void>>;
  linkProtocol(eventKey: string, protocolPath: string): Promise<Result<void>>;
  markCancelled(eventKey: string): Promise<Result<void>>;
}

export interface ProtocolNoteRepository {
  createFromEvent(event: Event, meetingPath: string): Promise<Result<{ path: string }>>;
  createEmpty(): Promise<Result<{ path: string }>>;
  appendRecordingFile(protocolPath: string, recordingPath: string): Promise<Result<void>>;
}

export interface OutboxRepository {
  list(): Promise<Result<unknown[]>>;
  enqueue(item: unknown): Promise<Result<void>>;
  replace(items: unknown[]): Promise<Result<void>>;
}
```

### 4.5. Интерфейсы сервисов Application слоя (use-cases)

```ts
export interface RefreshCalendarsUseCase {
  execute(): Promise<Result<{ refreshedAt: number; errors: AppErrorDto[] }>>;
}

export interface SyncMeetingNotesUseCase {
  execute(params: { horizonDays: number }): Promise<Result<{ synced: number }>>;
}

export interface ScheduleNotificationsUseCase {
  execute(): Result<void>; // планирование локальных таймеров
}

export interface SetRsvpStatusUseCase {
  execute(params: { eventKey: string; partstat: "accepted" | "declined" | "tentative" | "needs_action" }): Promise<Result<void>>;
}

export interface RecordingUseCase {
  start(params: { target: "event" | "protocol" | "manual"; eventKey?: string; protocolPath?: string }): Promise<Result<void>>;
  pause(): Promise<Result<void>>;
  resume(): Promise<Result<void>>;
  stop(): Promise<Result<void>>;
  getStats(): RecordingStatsDto;
}
```

### 4.6. Стратегия логирования (сквозной concern)

Текущее состояние хорошее (есть `LogService`, file writer, redaction). Цель — сделать единый контракт и дисциплину:

- **Интерфейс**
  - `Logger.info/warn/error(message, context)`
  - контекст — объект, всегда redacted (URL/токены/пароли).
- **События**
  - use-case start/end + durationMs
  - отдельные `error.code` и `error.details`
- **Хранилища**
  - in-memory для UI “Лог”
  - file sink для долговременности
- **Политика**
  - секреты никогда не пишем в логи (как сейчас в `getSettingsSummaryForLog`).

---

## 5) Новая структура папок (целевой layout)

Пример (можно адаптировать под esbuild и Obsidian):

```
src/
  plugin/
    assistantPlugin.ts              // тонкий Obsidian Plugin (composition root)
    pluginContext.ts                // сбор DI/контейнера, wiring
  presentation/
    obsidian/
      views/
      settings/
      commands/
    electronWindow/
      reminder/
      recording/
      bridge/                       // transport + typed messages
  application/
    usecases/
    services/                       // координация, не UI
  domain/
    calendar/
    meeting/
    protocol/
    person/
    project/
    identity/
    errors/
  infrastructure/
    calendar/
      ics/
      caldav/
    obsidianVault/
      notes/
      frontmatter/
      indexes/
    recording/
      backends/
    offline/
    logging/
  shared/
    result.ts
    contracts/                      // DTO for UI/IPC
    validation/                     // zod schemas
```

---

## 6) План работ (инкрементально, без остановки продукта)

Ниже — последовательность, где **каждый этап оставляет плагин рабочим**. Оценка сложности: S/M/L.

### Этап 0: Подготовка (S)

- **Цель**: создать “скелет” будущей архитектуры без изменения поведения.
- **Действия**
  - Добавить папки `src/domain`, `src/application`, `src/infrastructure`, `src/presentation`, `src/shared`.
  - Ввести `Result<T>` и `AppErrorDto` (как контракт), не переписывая весь код сразу.
  - Выбрать DI подход:
    - минимально: ручной `PluginContext` (factory functions)
    - или контейнер: **Tsyringe** (рекомендация) / Inversify (тяжелее).
  - Ввести runtime-валидацию DTO (рекомендация: **Zod**).
- **Тесты**
  - Добавить юнит-тесты на `Result/AppError` (минимально, чтобы зафиксировать формат).

### Этап 1: Контракты и транспорт “IPC” для окон (M)

- **Цель**: централизовать каналы/сообщения, при этом оставить текущий transport (`document.title`/`executeJavaScript`) как временный адаптер.
- **Действия**
  - Создать `WindowBridge` интерфейс (send/subscribe).
  - Реализовать адаптер `TitleActionBridge` (старый способ) и `ExecuteJsPushBridge`.
  - Вынести все строки действий (`assistant-action:*`, `rec_start:*`) в единый union `WindowAction`.
  - Ввести `IpcChannel` + envelope с `id/ts`.
  - Единый обработчик ошибок/таймаутов (например “если окно не ready за 2s — закрыть и залогировать”).
- **Тесты**
  - Юнит-тесты на парсинг/маршрутизацию действий.

**Статус (выполнено в репозитории): ✅**
- Добавлены контракты: `src/presentation/electronWindow/bridge/windowBridgeContracts.ts`.
- Добавлен backward-compatible транспорт для `document.title`: `src/presentation/electronWindow/bridge/titleActionTransport.ts` + тесты `tests/windowBridge/titleActionTransport.test.ts`.
- `electron_window` окна переведены на централизованный парсер действий без изменения формата строк:
  - `src/notifications/electronWindowReminder.ts`
  - `src/recording/recordingDialog.ts`
- ⚠️ Транспорт всё ещё `document.title`/`page-title-updated` и `executeJavaScript` (это ожидаемо для этапа 1; полная замена на request/response транспорт — отдельный этап).

### Этап 2: Декомпозиция `main.ts` (L)

- **Цель**: превратить `main.ts` в тонкий composition root.
- **Действия**
  - Выделить:
    - `PluginBootstrap` (wiring сервисов)
    - `CommandsController`
    - `ViewsController`
    - `SettingsController`
  - Логику RSVP/outbox/auto-writeback перенести в use-cases.
  - В `main.ts` оставить только: регистрация, создание контекста, делегирование.
- **Тесты**
  - Добавить тесты на use-cases RSVP/outbox (без Obsidian UI).

**Статус (частично выполнено): ✅/⚠️**
- ✅ Вынесена регистрация команд в `src/presentation/obsidian/commands/registerAssistantCommands.ts` (коллбеки остаются в `main.ts`).
- ✅ Вынесена регистрация views в `src/presentation/obsidian/views/registerAssistantViews.ts` (коллбеки остаются в `main.ts`).
- ✅ Добавлены unit-тесты на регистрацию (минимальные фейки):
  - `tests/presentation/registerAssistantCommands.test.ts`
  - `tests/presentation/registerAssistantViews.test.ts`
- ✅ Обновлён Obsidian stub для тестов: `tests/stubs/obsidian.ts` (добавлен `ItemView`), чтобы можно было импортировать `AgendaView/LogView`.
- ⚠️ `main.ts` всё ещё содержит много orchestration/бизнес-логики (RSVP/outbox/recording). Это следующий подплан этапа 2/3: вынос use-cases и постепенное истончение `main.ts`.

### Этап 3: Разделить Calendar на Application+Infrastructure (M)

- **Цель**: убрать `new Provider()` из `CalendarService`, сделать registry провайдеров.
- **Действия**
  - Ввести `CalendarProvider` интерфейс + `CalendarProviderRegistry`.
  - `CalendarService` превращается в Application сервис поверх `CalendarEventStore`.
  - Провайдеры (`IcsUrlProvider`, `CaldavProvider`) становятся Infrastructure.
- **Тесты**
  - Тесты на CalendarService через моки провайдеров (быстрее/стабильнее).

**Статус (выполнено в репозитории): ✅/⚠️**
- ✅ Введён `CalendarProviderRegistry`: `src/calendar/providers/calendarProviderRegistry.ts`.
- ✅ `CalendarService` теперь зависит от registry (DIP) и не создаёт провайдеры внутри: `src/calendar/calendarService.ts`.
- ✅ Wiring обновлён (создание registry в `main.ts`).
- ✅ Тест `tests/calendarService.test.ts` обновлён под новый конструктор.
- ⚠️ Пока используется дефолтный registry, который создаёт реальные `IcsUrlProvider/CaldavProvider`. Следующий шаг для качества: добавить fake provider tests для refresh-потоков (чтобы не тянуть tsdav/obsidian requestUrl в эти тесты) и постепенно разделять Application/Infrastructure глубже.

### Этап 4: Разделить Vault-слой на репозитории (M)

- **Цель**: стандартизировать доступ к vault через репозитории.
- **Действия**
  - `EventNoteService` → `MeetingNoteRepository` (+ отдельный `MeetingNoteNamingPolicy` в domain).
  - `ProtocolNoteService`/`PersonNoteService`/`ProjectNoteService` → repos.
  - Индексы (`EventNoteIndexCache`) и persistent cache → отдельные infra repos.
- **Тесты**
  - Тесты на репозитории через stubs Obsidian (у вас уже есть `tests/stubs/obsidian.ts`).

**Статус (в процессе): ✅/⚠️**
- ✅ Введён порт `MeetingNoteRepository`: `src/application/contracts/meetingNoteRepository.ts`.
- ✅ `SyncService` теперь зависит от `MeetingNoteRepository`, а не от конкретного `EventNoteService` (DIP): `src/sync/syncService.ts`.
- ✅ Добавлены порты для сущностей:
  - `src/application/contracts/protocolNoteRepository.ts`
  - `src/application/contracts/personRepository.ts`
  - `src/application/contracts/projectRepository.ts`
- ✅ Введены первые immutable value objects + чистые функции идентичности:
  - `src/domain/identity/eventKey.ts` (`EventKey`, `makeEventKey`, `parseEventKey`)
  - `src/domain/identity/protocolId.ts` (`ProtocolId`)
  - `src/ids/stableIds.ts` теперь переиспользует доменный `makeEventKey` (совместимость сохранена)
- ✅ `npm run typecheck` и `npm test` проходят.
- ⚠️ Пока “политики” (например naming/linking для заметок) остаются внутри сервисов vault. Следующий шаг этапа 4: вынос policy-функций (pure) для именования/линковки/инвариантов в domain/shared.
  - ✅ Частично вынесено: legacy-поддержка sid (`"... [sid].md"`) как чистая policy-функция: `src/domain/policies/legacyStableId.ts` (+ тест `tests/domain/legacyStableId.test.ts`).
  - ✅ Вынесено: policy именования файла встречи (pretty basename + maxLen) как pure-функция: `src/domain/policies/meetingNoteNaming.ts` (+ тест `tests/domain/meetingNoteNaming.test.ts`).
  - ✅ Вынесено: policy wiki-link (strip `.md` + `- [[target|label]]`) как pure-функция: `src/domain/policies/wikiLink.ts` (+ тест `tests/domain/wikiLink.test.ts`).
  - ✅ Вынесено: policy группировки участников по PARTSTAT + email→person_id как pure-функция: `src/domain/policies/attendeesGrouping.ts` (+ тест `tests/domain/attendeesGrouping.test.ts`).
  - ✅ Вынесено: policy отображения PARTSTAT в ru-label (придёт/не придёт/…) как pure-функция: `src/domain/policies/partstatLabelRu.ts` (+ тест `tests/domain/partstatLabelRu.test.ts`).
  - ✅ Вынесено: policy отображения RSVP статуса (accepted/declined/…) в badge для UI как pure-функция: `src/domain/policies/rsvpStatusBadgeRu.ts` (+ тест `tests/domain/rsvpStatusBadgeRu.test.ts`). `AgendaView` переиспользует эту policy.
  - ✅ Вынесено: policy сводки attendees для tooltip в UI (подсчёт PARTSTAT + формат RU) как pure-функция: `src/domain/policies/attendeesSummaryRu.ts` (+ тест `tests/domain/attendeesSummaryRu.test.ts`). `AgendaView` переиспользует эту policy.
  - ✅ Вынесено: policy рендера markdown-списка участников (sort/email/cn/label) как pure-функция: `src/domain/policies/attendeesMarkdownRu.ts` (+ тест `tests/domain/attendeesMarkdownRu.test.ts`). `EventNoteService` переиспользует эту policy.
  - ✅ Вынесено: policy извлечения frontmatter-данных встречи (organizer/reminders/attendees grouping и т.п.) как pure-функция: `src/domain/policies/meetingFrontmatterData.ts` (+ тест `tests/domain/meetingFrontmatterData.test.ts`). `EventNoteService` переиспользует эту policy.
  - ✅ Вынесено: policy генерации YAML-строк для frontmatter списков как pure-функция: `src/domain/policies/frontmatterYaml.ts` (+ тест `tests/domain/frontmatterYaml.test.ts`). `EventNoteService` переиспользует эту policy.
  - ✅ Вынесено: policy шаблона карточки встречи (markdown) как pure-функция: `src/domain/policies/meetingNoteTemplate.ts` (+ тест `tests/domain/meetingNoteTemplate.test.ts`). `EventNoteService.renderEventFile` теперь делегирует в эту policy.
  - ✅ Вынесено: чистые политики работы с markdown‑секциями и frontmatter:
    - `src/domain/policies/assistantMarkdownSections.ts` (ASSISTANT markers: merge/extract/upsert)
    - `src/domain/policies/frontmatter.ts` (split/parse/stringify/upsert)
    - `src/domain/policies/yamlEscape.ts` (yamlEscape)
    - `src/vault/{markdownSections,frontmatter,yamlEscape}.ts` теперь тонкие re-export’ы; тесты переведены на domain/policies импорты.
  - ✅ Вынесено: парсинг DTO и ключи frontmatter как чистые policy:
    - `src/domain/policies/frontmatterKeys.ts` (FM + `isAssistantEntityType`)
    - `src/domain/policies/frontmatterDtos.ts` (parseMeeting/Protocol/Person/Project)
    - `src/vault/{frontmatterKeys,frontmatterDtos}.ts` теперь re-export’ы; тесты переведены на domain/policies импорты.
  - ✅ Продолжение выноса policy (templates/naming/ids/normalize):
    - `src/domain/policies/normalizeEmail.ts` (+ тест `tests/domain/normalizeEmail.test.ts`) — убирает дубли (ICS/person/stableIds).
    - `src/domain/policies/sanitizeFileName.ts` — `src/vault/fileNaming.ts` re-export.
    - `src/domain/policies/vaultPaths.ts` — `src/vault/vaultPaths.ts` re-export.
    - `src/domain/policies/pseudoRandomId.ts` (+ тест `tests/domain/pseudoRandomId.test.ts`) — “нестабильные” id через инъекцию now/random.
    - `src/domain/policies/protocolNoteNaming.ts`, `src/domain/policies/protocolNoteTemplate.ts` (+ тест `tests/domain/protocolNoteTemplate.test.ts`) — ProtocolNoteService делегирует в policy.
    - `src/domain/policies/projectNoteTemplate.ts`, `src/domain/policies/personNoteTemplate.ts` — Project/Person services используют чистые шаблоны.
  - ✅ Recording: вынесены чистые куски в policy:
    - `src/domain/policies/recordingTarget.ts` (+ тест `tests/domain/recordingTarget.test.ts`) — выбор дефолтной цели записи (встреча/новый протокол).
    - `src/domain/policies/ffmpegFilterGraph.ts` (+ тест `tests/domain/ffmpegFilterGraph.test.ts`) — генерация Linux ffmpeg filtergraph.
    - `src/domain/policies/escHtml.ts` (+ тест `tests/domain/escHtml.test.ts`) — HTML escaping для диалога записи.
  - ✅ Recording dialog / MediaRecorder:
    - `src/domain/policies/recordingDialogModel.ts` (+ тест `tests/domain/recordingDialogModel.test.ts`) — подготовка данных для диалога записи (occurrences/meetingNames/lockedLabel/meta/autoSeconds).
    - `src/domain/policies/mediaRecorderMimeType.ts` (+ тест `tests/domain/mediaRecorderMimeType.test.ts`) — выбор mimeType через инъекцию `isSupported`, использовано в `RecordingService`.
  - ✅ Recording: chunk timing как policy:
    - `src/domain/policies/recordingChunkTiming.ts` (+ тест `tests/domain/recordingChunkTiming.test.ts`) — вычисление `nextChunkInMs` и условия ротации чанка.
  - ✅ Recording: визуализация уровня как policy:
    - `src/domain/policies/recordingVizAmp.ts` (+ тест `tests/domain/recordingVizAmp.test.ts`) — mapping LUFS/RMS→amp01 и сглаживание, используется в `RecordingService`.
  - ✅ Recording: вынос “pure” частей парсинга метрик:
    - `src/domain/policies/ebur128.ts` (+ тест `tests/domain/ebur128.test.ts`) — парсинг `M:` LUFS из stderr ebur128.
    - `src/domain/policies/pcmRms.ts` (+ тест `tests/domain/pcmRms.test.ts`) — RMS из PCM s16le mono кадра.
    - `src/domain/policies/rateLimit.ts` (+ тест `tests/domain/rateLimit.test.ts`) — rate-limit эмита визуализации.
  - ✅ Recording: парсинг JSON-массивов из frontmatter:
    - `src/domain/policies/frontmatterJsonArrays.ts` (+ тест `tests/domain/frontmatterJsonArrays.test.ts`) — чтение `files:` (и подобных) как JSON массива строк.
  - ✅ Recording: rolling buffers / file naming как policy:
    - `src/domain/policies/rollingTextBuffer.ts` (+ тест `tests/domain/rollingTextBuffer.test.ts`) — append+truncate и splitLinesKeepRemainder для stderr/viz буферов.
    - `src/domain/policies/recordingFileNaming.ts` (+ тест `tests/domain/recordingFileNaming.test.ts`) — prefix/timestamp/filename для файлов записи, используется в `RecordingService`.
  - ✅ Recording: desktop/pactl эвристики как policy:
    - `src/domain/policies/desktopCapturerSource.ts` (+ тест `tests/domain/desktopCapturerSource.test.ts`) — выбор `desktopCapturer` sourceId по имени.
    - `src/domain/policies/pactl.ts` (+ тест `tests/domain/pactl.test.ts`) — парсинг `pactl` stdout и построение кандидатов monitor/mic.
    - `buildPulseMicCandidates` вынесен в policy (default source + алиасы + дедуп); `RecordingService.guessPulseMicSource` делегирует в policy.
  - ✅ Recording (Linux Native): ffmpeg args builder как policy:
    - `src/domain/policies/linuxNativeFfmpegArgs.ts` (+ тест `tests/domain/linuxNativeFfmpegArgs.test.ts`) — сборка argv для `ffmpeg` (inputs/outputs/viz).
  - ✅ Recording (Linux Native): план перебора источников как policy:
    - `src/domain/policies/linuxNativeSourcePlan.ts` (+ тест `tests/domain/linuxNativeSourcePlan.test.ts`) — стратегия попыток mic×monitor в порядке кандидатов.
  - ✅ Recording: логирование/текст как policy:
    - `src/domain/policies/logText.ts` (+ тест `tests/domain/logText.test.ts`) — `trimForLogPolicy`.
  - ✅ Recording: последние мелкие policy:
    - `src/domain/policies/recordingPaths.ts` — дефолтный путь записей (`DEFAULT_RECORDINGS_DIR`).
    - `src/domain/policies/recordingExt.ts` (+ тест `tests/domain/recordingExt.test.ts`) — выбор расширения `ogg/webm` по mimeType.
  - ✅ Vault ports: существующие Obsidian-сервисы теперь явно реализуют контракты Application слоя:
    - `EventNoteService implements MeetingNoteRepository`
    - `ProtocolNoteService implements ProtocolNoteRepository`
    - `PersonNoteService implements PersonRepository`
    - `ProjectNoteService implements ProjectRepository`
- ✅ `PluginContext` подключён к runtime (Composition Root):
  - `src/plugin/pluginContext.ts` теперь создаёт сервисы вместо wiring в `main.ts`
  - и централизует применение настроек через `applySettings()` (используется в `initAsync` и `saveSettingsAndApply`)

### Этап 5: Рефакторинг записи (Recording) в 2 уровня (L)

- **Цель**: убрать “божественный” `RecordingService`.
- **Действия**
  - Application: `RecordingUseCase` (state machine + политика чанков + stats).
  - Infrastructure: `RecordingBackend` интерфейс:
    - `ElectronMediaRecorderBackend`
    - `LinuxFfmpegBackend`
  - Отдельно: `ProtocolAttachmentService` (прикрепление файлов в протокол).
  - Визуализация: контракт `onViz`/`RecordingVizEvent` через `WindowBridge`.
- **Тесты**
  - Юнит-тесты state machine без реального ffmpeg (моки backend’а).

### Этап 6: Презентационный слой (UI) сделать тонким (M)

- **Цель**: Views/Settings должны только отображать и вызывать use-cases.
- **Действия**
  - `AgendaView` не вызывает “много коллбеков”, а работает через `AgendaController`.
  - Settings UI вызывает `SettingsUseCase` (validate → save → apply).
- **Тесты**
  - Тесты на контроллеры (без DOM, где возможно).

### Этап 7: Стандартизация “качества” (S)

- **CI**: добавить pipeline (format:check, typecheck, test, coverage).
- **Линтер**: ESLint (если готовы) или оставить текущий стиль, но зафиксировать правила.
- **Валидация**: Zod схемы для settings/IPC payloads.

---

## 7) Рекомендации по инструментам

- **DI**
  - **Tsyringe**: проще, меньше boilerplate; хорошо для инкрементального внедрения.
  - Inversify: мощнее, но тяжелее и требует дисциплины.
- **Валидация DTO**
  - **Zod**: самый практичный для TS, быстрый старт, удобно для IPC/settings.
  - io-ts: более “FP”, выше порог входа.
- **Result/ошибки**
  - либо свой `Result<T>`,
  - либо `neverthrow` (если хотите готовый паттерн).
- **Тесты**
  - Vitest оставить (уже хорошо покрыто).
  - Добавить тесты на use-cases и адаптеры “IPC”.

---

## 8) Критические приоритеты (что даст максимум эффекта)

1) **Контракты “IPC” для окон + централизация каналов** (сейчас это главный техдолг по связанности и стабильности UI).  
2) **Декомпозиция `main.ts`** (снижение когнитивной сложности и рисков регрессий).  
3) **Разделение Recording на backend + orchestrator** (самый рискованный и “шумный” домен).  
4) **DIP для calendar providers и vault repos** (ускоряет разработку, упрощает тестирование).

