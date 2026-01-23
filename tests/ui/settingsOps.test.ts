import { describe, expect, it, vi, beforeEach } from "vitest";

type ButtonRec = { text?: string; onClick?: () => unknown | Promise<unknown> };

function makeFakeContainerEl(): any {
  const makeEl = (tag: string, opts?: any) => {
    const el: any = {
      tag,
      text: opts?.text,
      cls: opts?.cls,
      style: {},
      children: [] as any[],
      empty() {
        this.children = [];
      },
      setText(t: string) {
        this.text = t;
      },
      createEl(t: string, o?: any) {
        const c = makeEl(t, o);
        this.children.push(c);
        return c;
      },
      createDiv(o?: any) {
        const c = makeEl("div", o);
        this.children.push(c);
        return c;
      },
    };
    return el;
  };

  return makeEl("root");
}

function installObsidianSettingMock(buttons: ButtonRec[]) {
  class FakeSetting {
    constructor(public containerEl: any) {
      void containerEl;
    }
    setName(_v: string) {
      return this;
    }
    setDesc(_v: string) {
      return this;
    }
    addButton(cb: (b: any) => void) {
      const rec: ButtonRec = {};
      const b = {
        setButtonText: (t: string) => {
          rec.text = t;
          return b;
        },
        setDisabled: (_v: boolean) => b,
        setWarning: () => b,
        onClick: (fn: any) => {
          rec.onClick = fn;
          return b;
        },
      };
      cb(b);
      buttons.push(rec);
      return this;
    }
    addToggle(cb: (t: any) => void) {
      const t = { setValue: (_v: boolean) => t, onChange: (_fn: any) => t };
      cb(t);
      return this;
    }
    addText(cb: (t: any) => void) {
      const t = { setPlaceholder: (_v: string) => t, setValue: (_v: string) => t, onChange: (_fn: any) => t };
      cb(t);
      return this;
    }
    addDropdown(cb: (dd: any) => void) {
      const dd = { addOption: (_k: string, _v: string) => dd, setValue: (_v: string) => dd, onChange: (_fn: any) => dd };
      cb(dd);
      return this;
    }
  }

  vi.doMock("obsidian", () => ({ Setting: FakeSetting }));
}

async function importSection<T>(path: string): Promise<T> {
  // Изоляция моков obsidian между тестами.
  vi.resetModules();
  return (await import(path)) as any as T;
}

describe("Settings UI operations use settingsOps port", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calendarOperationsSection: кнопка вызывает plugin.settingsOps.refreshCalendars()", async () => {
    const buttons: ButtonRec[] = [];
    installObsidianSettingMock(buttons);
    const { renderCalendarOperationsSection } = await importSection<{ renderCalendarOperationsSection: any }>(
      "../../src/ui/settings/sections/calendarOperationsSection",
    );

    const plugin = {
      settingsOps: { refreshCalendars: vi.fn(async () => undefined) },
    } as any;

    renderCalendarOperationsSection({ containerEl: makeFakeContainerEl(), plugin });
    const btn = buttons.find((b) => b.text === "Обновить");
    expect(btn?.onClick).toBeTypeOf("function");
    await btn!.onClick!();
    expect(plugin.settingsOps.refreshCalendars).toHaveBeenCalledTimes(1);
  });

  it("outboxSection: on render calls getOutboxCount; buttons call applyOutbox/clearOutbox", async () => {
    const buttons: ButtonRec[] = [];
    installObsidianSettingMock(buttons);
    const { renderOutboxSection } = await importSection<{ renderOutboxSection: any }>("../../src/ui/settings/sections/outboxSection");

    const rerender = vi.fn();
    const plugin = {
      settingsOps: {
        getOutboxCount: vi.fn(async () => 3),
        applyOutbox: vi.fn(async () => undefined),
        clearOutbox: vi.fn(async () => undefined),
      },
    } as any;

    renderOutboxSection({ containerEl: makeFakeContainerEl(), plugin, rerenderPreservingScroll: rerender });

    // allow microtasks
    await Promise.resolve();
    expect(plugin.settingsOps.getOutboxCount).toHaveBeenCalledTimes(1);

    const applyBtn = buttons.find((b) => b.text === "Применить");
    await applyBtn!.onClick!();
    expect(plugin.settingsOps.applyOutbox).toHaveBeenCalledTimes(1);
    expect(rerender).toHaveBeenCalledTimes(1);

    const clearBtn = buttons.find((b) => b.text === "Очистить");
    await clearBtn!.onClick!();
    expect(plugin.settingsOps.clearOutbox).toHaveBeenCalledTimes(1);
    expect(rerender).toHaveBeenCalledTimes(2);
  });

  it("logSection: нет кнопок открытия логов (есть только настройки maxEntries/retentionDays)", async () => {
    const buttons: ButtonRec[] = [];
    installObsidianSettingMock(buttons);
    const { renderLogSection } = await importSection<{ renderLogSection: any }>("../../src/ui/settings/sections/logSection");

    const plugin = {
      settings: { debug: { enabled: true }, log: { maxEntries: 10, retentionDays: 7 } },
      settingsOps: {
        openLogPanel: vi.fn(async () => undefined),
        openTodayLogFile: vi.fn(async () => undefined),
      },
      applySettingsCommand: vi.fn(async () => undefined),
    } as any;

    renderLogSection({ containerEl: makeFakeContainerEl(), plugin });

    // В секции больше нет кнопок "Открыть"/"Открыть файл" — эти действия доступны внутри панели лога.
    expect(buttons.some((b) => b.text === "Открыть")).toBe(false);
    expect(buttons.some((b) => b.text === "Открыть файл")).toBe(false);
  });

  it("recordingSection (linux_native): кнопка 'Проверить' вызывает checkLinuxNativeRecordingDependencies()", async () => {
    const buttons: ButtonRec[] = [];
    installObsidianSettingMock(buttons);
    const { renderRecordingSection } = await importSection<{ renderRecordingSection: any }>(
      "../../src/ui/settings/sections/recordingSection",
    );

    const plugin = {
      settings: {
        recording: {
          audioBackend: "linux_native",
          linuxNativeAudioProcessing: "normalize",
          chunkMinutes: 5,
          autoStartEnabled: true,
          autoStartSeconds: 5,
        },
      },
      settingsOps: { checkLinuxNativeRecordingDependencies: vi.fn(async () => undefined) },
      applySettingsCommand: vi.fn(async () => undefined),
    } as any;

    renderRecordingSection({ containerEl: makeFakeContainerEl(), plugin });
    const checkBtn = buttons.find((b) => b.text === "Проверить");
    expect(checkBtn?.onClick).toBeTypeOf("function");
    await checkBtn!.onClick!();
    expect(plugin.settingsOps.checkLinuxNativeRecordingDependencies).toHaveBeenCalledTimes(1);
  });

  it("calendarBlock: кнопка 'Обновить' вызывает settingsOps.refreshCalendar(cal.id)", async () => {
    const buttons: ButtonRec[] = [];
    installObsidianSettingMock(buttons);
    const { renderCalendarBlock } = await importSection<{ renderCalendarBlock: any }>("../../src/ui/settings/sections/calendarBlocks");

    const plugin = {
      settings: { caldav: { accounts: [] } },
      settingsOps: { refreshCalendar: vi.fn(async () => undefined) },
      applySettingsCommand: vi.fn(async () => undefined),
      caldavAccounts: { authorizeGoogle: vi.fn(async () => undefined) },
    } as any;

    const cal = { id: "c1", name: "C", type: "ics_url", enabled: true, url: "x" };
    renderCalendarBlock({ containerEl: makeFakeContainerEl(), plugin, cal, rerenderPreservingScroll: vi.fn() });

    const btn = buttons.find((b) => b.text === "Обновить");
    await btn!.onClick!();
    expect(plugin.settingsOps.refreshCalendar).toHaveBeenCalledWith("c1");
  });
});
