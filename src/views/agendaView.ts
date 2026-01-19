import { ItemView, Menu, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type { AssistantSettings, CalendarEvent } from "../types";
import type { CalendarService } from "../calendar/calendarService";

export const AGENDA_VIEW_TYPE = "assistant-agenda";
const RU = "ru-RU";
const HOUR_HEIGHT_PX = 48;

export class AgendaView extends ItemView {
  private settings: AssistantSettings;
  private calendarService: CalendarService;
  private openLog?: () => void;
  private openEvent?: (ev: CalendarEvent) => void;
  private getProtocolMenuState?: (ev: CalendarEvent) => Promise<{
    hasCurrent: boolean;
    hasLatest: boolean;
    currentIsLatest: boolean;
  }>;
  private openCurrentProtocol?: (ev: CalendarEvent) => void | Promise<void>;
  private openLatestProtocol?: (ev: CalendarEvent) => void | Promise<void>;
  private createProtocol?: (ev: CalendarEvent) => void;
  private debugShowReminder?: (ev: CalendarEvent) => void;
  private unsubscribe?: () => void;
  private tickTimer?: number;
  private dayOffset = 0;

  constructor(
    leaf: WorkspaceLeaf,
    settings: AssistantSettings,
    calendarService: CalendarService,
    openLog?: () => void,
    openEvent?: (ev: CalendarEvent) => void,
    getProtocolMenuState?: (ev: CalendarEvent) => Promise<{
      hasCurrent: boolean;
      hasLatest: boolean;
      currentIsLatest: boolean;
    }>,
    openCurrentProtocol?: (ev: CalendarEvent) => void | Promise<void>,
    openLatestProtocol?: (ev: CalendarEvent) => void | Promise<void>,
    createProtocol?: (ev: CalendarEvent) => void,
    debugShowReminder?: (ev: CalendarEvent) => void,
  ) {
    super(leaf);
    this.settings = settings;
    this.calendarService = calendarService;
    this.openLog = openLog;
    this.openEvent = openEvent;
    this.getProtocolMenuState = getProtocolMenuState;
    this.openCurrentProtocol = openCurrentProtocol;
    this.openLatestProtocol = openLatestProtocol;
    this.createProtocol = createProtocol;
    this.debugShowReminder = debugShowReminder;
  }

  getViewType(): string {
    return AGENDA_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Повестка";
  }

  getIcon(): string {
    return "calendar";
  }

  setSettings(settings: AssistantSettings) {
    this.settings = settings;
    this.render();
  }

  async onOpen() {
    const action = this.addAction("list", "Открыть лог", () => this.openLog?.());
    // Some Obsidian builds may overwrite action icons after onOpen().
    // Force icon now and once again on next frame.
    const force = () => {
      try {
        setIcon(action, "list");
      } catch {
        // ignore
      }
    };
    force();
    requestAnimationFrame(force);
    this.unsubscribe = this.calendarService.onChange(() => this.render());
    this.tickTimer = window.setInterval(() => this.renderClockOnly(), 30_000);
    this.render();
  }

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

    const events = selectDay(this.calendarService.getEvents(), this.settings, this.dayOffset);

    const allDay = events.filter((e) => e.allDay);
    const timed = events.filter((e) => !e.allDay);

    if (allDay.length > 0) {
      const box = el.createDiv({ cls: "assistant-agenda__allday" });
      box.createDiv({ text: "Весь день", cls: "assistant-agenda__allday-title" });
      const pills = box.createDiv({ cls: "assistant-agenda__allday-items" });
      for (const ev of allDay) {
        const pill = pills.createDiv({ cls: "assistant-agenda__allday-pill" });
        pill.createSpan({ text: ev.summary });
        const resp = partstatLabel(ev.myPartstat);
        if (resp) pill.createSpan({ text: resp, cls: `assistant-agenda__resp ${partstatClass(ev.myPartstat)}` });
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

    // "now" indicator on timeline (only for today)
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

      const title = node.createDiv({ cls: "assistant-agenda__block-title" });
      title.createSpan({ text: b.event.summary });
      const resp = partstatLabel(b.event.myPartstat);
      if (resp) title.createSpan({ text: resp, cls: `assistant-agenda__resp ${partstatClass(b.event.myPartstat)}` });

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

  private openEventMenu(ev: CalendarEvent, e: MouseEvent) {
    void this.openEventMenuAsync(ev, e);
  }

  private async openEventMenuAsync(ev: CalendarEvent, e: MouseEvent) {
    const menu = new Menu();

    menu.addItem((it) => {
      it.setTitle("Перейти").setIcon("link").onClick(() => {
        if (this.openEvent) this.openEvent(ev);
        else new Notice(`${formatWhen(ev)} — ${ev.summary}`);
      });
    });

    if (this.getProtocolMenuState) {
      const state = await this.getProtocolMenuState(ev);

      if (state.hasCurrent && this.openCurrentProtocol) {
        menu.addItem((it) => {
          it.setTitle("Открыть текущий протокол").setIcon("file-text").onClick(() => void this.openCurrentProtocol?.(ev));
        });
      }

      if (state.hasLatest && !state.currentIsLatest && this.openLatestProtocol) {
        menu.addItem((it) => {
          it.setTitle("Открыть последний протокол").setIcon("file-text").onClick(() => void this.openLatestProtocol?.(ev));
        });
      }

      if (!state.hasCurrent && this.createProtocol) {
        menu.addItem((it) => {
          it.setTitle("Создать новый протокол").setIcon("file-plus").onClick(() => this.createProtocol?.(ev));
        });
      }
    } else if (this.createProtocol) {
      // Fallback
      menu.addItem((it) => {
        it.setTitle("Создать новый протокол").setIcon("file-plus").onClick(() => this.createProtocol?.(ev));
      });
    }

    if (this.settings.debug?.enabled && this.debugShowReminder) {
      menu.addSeparator();
      menu.addItem((it) => {
        it.setTitle("Показать напоминание").setIcon("bell").onClick(() => this.debugShowReminder?.(ev));
      });
    }

    menu.showAtPosition({ x: e.pageX, y: e.pageY });
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

function formatWhen(ev: CalendarEvent): string {
  if (ev.allDay) return ev.start.toLocaleDateString(RU, { month: "2-digit", day: "2-digit" }) + " • весь день";
  return ev.start.toLocaleString(RU, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function partstatLabel(ps: CalendarEvent["myPartstat"]): string {
  if (ps === "accepted") return " • принята";
  if (ps === "declined") return " • отклонена";
  if (ps === "tentative") return " • под вопросом";
  if (ps === "needs_action") return " • не отвечено";
  return "";
}

function partstatClass(ps: CalendarEvent["myPartstat"]): string {
  if (ps === "accepted") return "assistant-agenda__resp--accepted";
  if (ps === "declined") return "assistant-agenda__resp--declined";
  if (ps === "tentative") return "assistant-agenda__resp--tentative";
  if (ps === "needs_action") return "assistant-agenda__resp--needs-action";
  return "";
}

function formatDayLabel(dayOffset: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + dayOffset);
  return d.toLocaleDateString(RU, { weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" });
}

function selectDay(events: CalendarEvent[], settings: AssistantSettings, dayOffset: number): CalendarEvent[] {
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
  event: CalendarEvent;
  top: number;
  height: number;
  col: number;
  colCount: number;
  timeLabel: string;
};

function layoutTimedEvents(events: CalendarEvent[], dayOffset: number): TimedBlock[] {
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
    // drop finished
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].endMs <= it.startMs) active.splice(i, 1);
    }
    if (active.length === 0 && clusterEvents.length > 0) {
      finalizeCluster();
    }

    // find smallest free column index
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
