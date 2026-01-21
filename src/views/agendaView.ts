import { ItemView, Menu, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type { AssistantSettings, Event } from "../types";
import type { CalendarService } from "../calendar/calendarService";
import { makeEventKey } from "../ids/stableIds";

/** Тип Obsidian view для “Повестки”. */
export const AGENDA_VIEW_TYPE = "assistant-agenda";
const RU = "ru-RU";
const HOUR_HEIGHT_PX = 48;

/**
 * View “Повестка” — дневная сетка встреч + контекстные действия.
 *
 * Данные берёт из `CalendarService`, а действия (открыть лог/встречу/протокол) получает через коллбеки из `main.ts`.
 */
export class AgendaView extends ItemView {
  private settings: AssistantSettings;
  private calendarService: CalendarService;
  private openLog?: () => void;
  private openEvent?: (ev: Event) => void;
  private setMyPartstat?: (ev: Event, partstat: NonNullable<Event["status"]>) => Promise<void> | void;
  private getProtocolMenuState?: (ev: Event) => Promise<{
    hasCurrent: boolean;
    hasLatest: boolean;
    currentIsLatest: boolean;
  }>;
  private openCurrentProtocol?: (ev: Event) => void | Promise<void>;
  private openLatestProtocol?: (ev: Event) => void | Promise<void>;
  private createProtocol?: (ev: Event) => unknown | Promise<unknown>;
  private openRecorder?: (ev: Event) => void | Promise<void>;
  private debugShowReminder?: (ev: Event) => void;
  private unsubscribe?: () => void;
  private tickTimer?: number;
  private dayOffset = 0;
  /** Оптимистичное значение status, чтобы UI обновлялся сразу после клика. */
  private optimisticPartstatByEventKey = new Map<string, Event["status"]>();

  constructor(
    leaf: WorkspaceLeaf,
    settings: AssistantSettings,
    calendarService: CalendarService,
    openLog?: () => void,
    openEvent?: (ev: Event) => void,
    setMyPartstat?: (ev: Event, partstat: NonNullable<Event["status"]>) => Promise<void> | void,
    getProtocolMenuState?: (ev: Event) => Promise<{
      hasCurrent: boolean;
      hasLatest: boolean;
      currentIsLatest: boolean;
    }>,
    openCurrentProtocol?: (ev: Event) => void | Promise<void>,
    openLatestProtocol?: (ev: Event) => void | Promise<void>,
    createProtocol?: (ev: Event) => unknown | Promise<unknown>,
    openRecorder?: (ev: Event) => void | Promise<void>,
    debugShowReminder?: (ev: Event) => void,
  ) {
    super(leaf);
    this.settings = settings;
    this.calendarService = calendarService;
    this.openLog = openLog;
    this.openEvent = openEvent;
    this.setMyPartstat = setMyPartstat;
    this.getProtocolMenuState = getProtocolMenuState;
    this.openCurrentProtocol = openCurrentProtocol;
    this.openLatestProtocol = openLatestProtocol;
    this.createProtocol = createProtocol;
    this.openRecorder = openRecorder;
    this.debugShowReminder = debugShowReminder;
  }

  /** Obsidian: тип view. */
  getViewType(): string {
    return AGENDA_VIEW_TYPE;
  }

  /** Obsidian: заголовок вкладки. */
  getDisplayText(): string {
    return "Повестка";
  }

  /** Obsidian: иконка вкладки. */
  getIcon(): string {
    return "calendar";
  }

  /** Применить новые настройки (например после saveSettingsAndApply). */
  setSettings(settings: AssistantSettings) {
    this.settings = settings;
    this.render();
  }

  /** Принудительно перерисовать повестку (например после изменения карточки встречи). */
  refresh() {
    this.render();
  }

  /** Obsidian: lifecycle — при открытии подписываемся на обновления и рендерим. */
  async onOpen() {
    const action = this.addAction("list", "Открыть лог", () => this.openLog?.());
    // Некоторые сборки Obsidian могут перезатирать иконки действий после onOpen().
    // Поэтому принудительно ставим иконку сейчас и ещё раз на следующем кадре.
    const force = () => {
      try {
        setIcon(action, "list");
      } catch {
        // игнорируем
      }
    };
    force();
    requestAnimationFrame(force);
    this.unsubscribe = this.calendarService.onChange(() => this.render());
    this.tickTimer = window.setInterval(() => this.renderClockOnly(), 30_000);
    this.render();
  }

  /** Obsidian: lifecycle — снимаем таймеры/подписки. */
  async onClose() {
    this.unsubscribe?.();
    if (this.tickTimer) window.clearInterval(this.tickTimer);
  }

  private renderClockOnly() {
    const el = this.contentEl.querySelector("[data-assistant-now]");
    if (el) el.textContent = formatNow();
  }

  private render() {
    const el = this.contentEl;
    el.empty();
    el.addClass("assistant-agenda");

    const header = el.createDiv({ cls: "assistant-agenda__header" });
    header.createDiv({ text: "Повестка", cls: "assistant-agenda__title" });

    const nav = header.createDiv({ cls: "assistant-agenda__nav" });
    const prev = nav.createEl("button", { text: "←" });
    const today = nav.createEl("button", { text: "Сегодня" });
    const next = nav.createEl("button", { text: "→" });

    prev.onclick = () => {
      this.dayOffset -= 1;
      this.render();
    };
    today.onclick = () => {
      this.dayOffset = 0;
      this.render();
    };
    next.onclick = () => {
      this.dayOffset += 1;
      this.render();
    };

    header.createDiv({ text: formatDayLabel(this.dayOffset), cls: "assistant-agenda__day" });
    header.createDiv({ text: formatNow(), cls: "assistant-agenda__now", attr: { "data-assistant-now": "1" } });

    // Баннер “данные устарели”: если часть календарей не обновилась — показываем предупреждение, но продолжаем отображать кэш.
    const status = this.calendarService.getRefreshResult().perCalendar;
    {
      const entries = Object.entries(status);
      const stale = entries.filter(([, s]) => s.status === "stale");
      const total = entries.length;
      if (stale.length > 0 && total > 0) {
        const namesById = new Map(this.settings.calendars.map((c) => [c.id, c.name]));
        const staleNames = stale
          .map(([id]) => namesById.get(id) ?? id)
          .filter(Boolean)
          .slice(0, 5)
          .join(", ");
        const hintMore = stale.length > 5 ? ` (+${stale.length - 5})` : "";
        const text =
          `⚠️ Данные устарели: ${stale.length}/${total} календарей не обновились. ` +
          `Показываю последние сохранённые события. См. лог.` +
          (staleNames ? ` (${staleNames}${hintMore})` : "");
        el.createDiv({ cls: "assistant-agenda__notice assistant-agenda__notice--warning", text });
      }
    }

    const events = this.calendarService.getDayEvents(this.dayOffset, this.settings.agenda.maxEvents);

    const allDay = events.filter((e) => e.allDay);
    const timed = events.filter((e) => !e.allDay);

    if (allDay.length > 0) {
      const box = el.createDiv({ cls: "assistant-agenda__allday" });
      box.createDiv({ text: "Весь день", cls: "assistant-agenda__allday-title" });
      const pills = box.createDiv({ cls: "assistant-agenda__allday-items" });
      for (const ev of allDay) {
        const pill = pills.createDiv({ cls: "assistant-agenda__allday-pill" });
        const cal = this.settings.calendars.find((c) => c.id === ev.calendar.id);
        pill.title = this.buildEventTooltip(ev, cal?.name);
        pill.createSpan({ text: ev.summary });
        const resp = partstatLabel(ev.status);
        if (resp) pill.createSpan({ text: resp, cls: `assistant-agenda__resp ${partstatClass(ev.status)}` });
        pill.onclick = () => {
          if (this.openEvent) this.openEvent(ev);
          else new Notice(`${formatWhen(ev)} — ${ev.summary}`);
        };
        pill.oncontextmenu = (e) => {
          e.preventDefault();
          this.openEventMenu(ev, e);
        };
      }
    }

    const grid = el.createDiv({ cls: "assistant-agenda__grid" });
    const hours = grid.createDiv({ cls: "assistant-agenda__hours" });
    const timeline = grid.createDiv({ cls: "assistant-agenda__timeline" });
    timeline.style.height = `${24 * HOUR_HEIGHT_PX}px`;

    for (let h = 0; h < 24; h++) {
      const row = hours.createDiv({ cls: "assistant-agenda__hour" });
      row.textContent = `${String(h).padStart(2, "0")}:00`;
      const line = timeline.createDiv({ cls: "assistant-agenda__line" });
      line.style.top = `${h * HOUR_HEIGHT_PX}px`;
    }

    // Индикатор “сейчас” на таймлайне (только для сегодняшнего дня)
    if (this.dayOffset === 0) {
      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();
      const nowLine = timeline.createDiv({ cls: "assistant-agenda__nowline" });
      nowLine.style.top = `${(minutes / 60) * HOUR_HEIGHT_PX}px`;
    }

    if (timed.length === 0) {
      const empty = timeline.createDiv({ cls: "assistant-agenda__empty-overlay" });
      empty.textContent = "Нет встреч на этот день.";
      return;
    }

    const blocks = layoutTimedEvents(timed, this.dayOffset);
    for (const b of blocks) {
      const node = timeline.createDiv({ cls: "assistant-agenda__block" });
      node.style.top = `${b.top}px`;
      node.style.height = `${b.height}px`;
      node.style.left = `calc(${(b.col / b.colCount) * 100}% + 4px)`;
      node.style.width = `calc(${100 / b.colCount}% - 8px)`;

      const cal = this.settings.calendars.find((c) => c.id === b.event.calendar.id);
      node.title = this.buildEventTooltip(b.event, cal?.name);

      const title = node.createDiv({ cls: "assistant-agenda__block-title" });
      title.createSpan({ text: b.event.summary });
      const resp = partstatLabel(b.event.status);
      if (resp) title.createSpan({ text: resp, cls: `assistant-agenda__resp ${partstatClass(b.event.status)}` });

      node.onclick = () => {
        if (this.openEvent) this.openEvent(b.event);
        else new Notice(`${b.timeLabel} — ${b.event.summary}`);
      };

      node.oncontextmenu = (e) => {
        e.preventDefault();
        this.openEventMenu(b.event, e);
      };
    }
  }

  private openEventMenu(ev: Event, e: MouseEvent) {
    void this.openEventMenuAsync(ev, e);
  }

  private async openEventMenuAsync(ev: Event, e: MouseEvent) {
    const menu = new Menu();

    menu.addItem((it) => {
      it.setTitle("Перейти")
        .setIcon("link")
        .onClick(() => {
          if (this.openEvent) this.openEvent(ev);
          else new Notice(`${formatWhen(ev)} — ${ev.summary}`);
        });
    });

    if (this.openRecorder) {
      menu.addItem((it) => {
        it.setTitle("Диктофон")
          .setIcon("microphone")
          .onClick(() => void this.openRecorder?.(ev));
      });
    }

    if (this.setMyPartstat) {
      const ps = this.getMyPartstat(ev);
      menu.addSeparator();
      menu.addItem((it) => {
        it.setTitle(ps === "accepted" ? "✓ Принято" : "Принято")
          .setIcon("check")
          .onClick(() => void this.applyMyPartstat(ev, "accepted"));
      });
      menu.addItem((it) => {
        it.setTitle(ps === "declined" ? "✓ Отклонено" : "Отклонено")
          .setIcon("x")
          .onClick(() => void this.applyMyPartstat(ev, "declined"));
      });
      menu.addItem((it) => {
        it.setTitle(ps === "tentative" ? "✓ Возможно" : "Возможно")
          .setIcon("help-circle")
          .onClick(() => void this.applyMyPartstat(ev, "tentative"));
      });
      menu.addItem((it) => {
        it.setTitle(ps === "needs_action" ? "✓ Нет ответа" : "Нет ответа")
          .setIcon("minus-circle")
          .onClick(() => void this.applyMyPartstat(ev, "needs_action"));
      });
    }

    if (this.getProtocolMenuState) {
      const state = await this.getProtocolMenuState(ev);

      const canOpenLatest = state.hasLatest && this.openLatestProtocol;
      const canCreate = Boolean(this.createProtocol);
      if (canOpenLatest || canCreate) menu.addSeparator();

      if (canOpenLatest) {
        menu.addItem((it) => {
          it.setTitle("Открыть последний протокол")
            .setIcon("file-text")
            .onClick(() => void this.openLatestProtocol?.(ev));
        });
      }

      if (canCreate) {
        menu.addItem((it) => {
          it.setTitle("Создать новый протокол")
            .setIcon("file-plus")
            .onClick(() => this.createProtocol?.(ev));
        });
      }
    } else if (this.createProtocol) {
      menu.addSeparator();
      menu.addItem((it) => {
        it.setTitle("Создать новый протокол")
          .setIcon("file-plus")
          .onClick(() => this.createProtocol?.(ev));
      });
    }

    if (this.settings.debug?.enabled && this.debugShowReminder) {
      menu.addSeparator();
      menu.addItem((it) => {
        it.setTitle("Показать напоминание")
          .setIcon("bell")
          .onClick(() => this.debugShowReminder?.(ev));
      });
    }

    menu.showAtPosition({ x: e.pageX, y: e.pageY });
  }

  private getMyPartstat(ev: Event): Event["status"] | undefined {
    const key = makeEventKey(ev.calendar.id, ev.id);
    if (this.optimisticPartstatByEventKey.has(key)) {
      return this.optimisticPartstatByEventKey.get(key);
    }
    return ev.status;
  }

  private async applyMyPartstat(ev: Event, partstat: NonNullable<Event["status"]>): Promise<void> {
    const key = makeEventKey(ev.calendar.id, ev.id);
    this.optimisticPartstatByEventKey.set(key, partstat);
    this.render();
    try {
      await this.setMyPartstat?.(ev, partstat);
    } finally {
      // Дальше дождёмся refresh календаря с актуальным PARTSTAT; тут просто снимаем оверрайд на следующем рендере.
      this.optimisticPartstatByEventKey.delete(key);
    }
  }

  private buildEventTooltip(ev: Event, calendarName?: string): string {
    const parts: string[] = [];
    const calName = String(calendarName ?? "").trim();
    if (calName) parts.push(`Календарь: ${calName}`);
    const org = String(ev.organizer?.emails?.[0] ?? "").trim();
    if (org) parts.push(`Организатор: ${org}`);
    const att = attendeesTooltip(ev);
    if (att) parts.push(att);
    return parts.join("\n");
  }
}

function formatNow(): string {
  const now = new Date();
  return now.toLocaleString(RU, {
    weekday: "short",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatWhen(ev: Event): string {
  if (ev.allDay) return ev.start.toLocaleDateString(RU, { month: "2-digit", day: "2-digit" }) + " • весь день";
  return ev.start.toLocaleString(RU, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function partstatLabel(ps: Event["status"]): string {
  if (ps === "accepted") return " • принято";
  if (ps === "declined") return " • отклонено";
  if (ps === "tentative") return " • возможно";
  if (ps === "needs_action") return " • нет ответа";
  return "";
}

function partstatClass(ps: Event["status"]): string {
  if (ps === "accepted") return "assistant-agenda__resp--accepted";
  if (ps === "declined") return "assistant-agenda__resp--declined";
  if (ps === "tentative") return "assistant-agenda__resp--tentative";
  if (ps === "needs_action") return "assistant-agenda__resp--needs-action";
  return "";
}

function attendeesTooltip(ev: Event): string {
  const a = ev.attendees ?? [];
  if (!a.length) return "";
  let yes = 0;
  let no = 0;
  let maybe = 0;
  let unknown = 0;
  for (const x of a) {
    const ps = String(x.partstat ?? "")
      .trim()
      .toUpperCase();
    if (ps === "ACCEPTED") yes++;
    else if (ps === "DECLINED") no++;
    else if (ps === "TENTATIVE") maybe++;
    else unknown++;
  }
  const parts: string[] = [];
  if (yes > 0) parts.push(`Принято: ${yes}`);
  if (no > 0) parts.push(`Отклонено: ${no}`);
  if (maybe > 0) parts.push(`Возможно: ${maybe}`);
  if (unknown > 0) parts.push(`Нет ответа: ${unknown}`);
  return parts.length ? parts.join("; ") + ";" : "";
}

function formatDayLabel(dayOffset: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + dayOffset);
  return d.toLocaleDateString(RU, { weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" });
}

function selectDay(events: Event[], settings: AssistantSettings, dayOffset: number): Event[] {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + dayOffset);
  const start = day.getTime();
  const end = start + 24 * 60 * 60 * 1000;

  return events
    .filter((e) => {
      const t = e.start.getTime();
      return t >= start && t < end;
    })
    .slice(0, Math.max(1, settings.agenda.maxEvents));
}

type TimedBlock = {
  event: Event;
  top: number;
  height: number;
  col: number;
  colCount: number;
  timeLabel: string;
};

function layoutTimedEvents(events: Event[], dayOffset: number): TimedBlock[] {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + dayOffset);
  const dayStart = day.getTime();
  const dayEnd = dayStart + 24 * 60 * 60_000;

  const items = events
    .map((e) => {
      const startMs = e.start.getTime();
      const endMs = e.end?.getTime() ?? startMs + 30 * 60_000;
      return {
        event: e,
        startMs: Math.max(startMs, dayStart),
        endMs: Math.min(Math.max(endMs, startMs + 5 * 60_000), dayEnd),
      };
    })
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  type Active = { endMs: number; col: number };
  const active: Active[] = [];
  const blocks: Array<TimedBlock & { _cluster: number }> = [];

  let clusterId = 0;
  let clusterEvents: Array<{ idx: number }> = [];
  let clusterMaxCols = 0;

  const finalizeCluster = () => {
    for (const ce of clusterEvents) {
      blocks[ce.idx].colCount = Math.max(1, clusterMaxCols);
    }
    clusterEvents = [];
    clusterMaxCols = 0;
    clusterId += 1;
  };

  for (const it of items) {
    // Удаляем завершившиеся интервалы из active.
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].endMs <= it.startMs) active.splice(i, 1);
    }
    if (active.length === 0 && clusterEvents.length > 0) {
      finalizeCluster();
    }

    // Находим минимальный свободный индекс колонки.
    const used = new Set(active.map((a) => a.col));
    let col = 0;
    while (used.has(col)) col++;

    active.push({ endMs: it.endMs, col });
    clusterMaxCols = Math.max(clusterMaxCols, active.length);

    const startMin = (it.startMs - dayStart) / 60_000;
    const endMin = (it.endMs - dayStart) / 60_000;

    const top = (startMin / 60) * HOUR_HEIGHT_PX;
    const height = Math.max(18, ((endMin - startMin) / 60) * HOUR_HEIGHT_PX);

    const timeLabel = formatTimeRange(it.startMs, it.endMs);

    const idx = blocks.length;
    blocks.push({
      event: it.event,
      top,
      height,
      col,
      colCount: 1,
      timeLabel,
      _cluster: clusterId,
    });
    clusterEvents.push({ idx });
  }

  if (clusterEvents.length > 0) finalizeCluster();
  return blocks;
}

function formatTimeRange(startMs: number, endMs: number): string {
  const s = new Date(startMs).toLocaleTimeString(RU, { hour: "2-digit", minute: "2-digit" });
  const e = new Date(endMs).toLocaleTimeString(RU, { hour: "2-digit", minute: "2-digit" });
  return `${s}–${e}`;
}
