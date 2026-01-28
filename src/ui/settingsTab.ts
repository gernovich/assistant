import { App, PluginSettingTab } from "obsidian";
import type AssistantPlugin from "../../main";
import { renderAutoRefreshSection } from "./settings/sections/autoRefreshSection";
import { renderCaldavAccountsSection } from "./settings/sections/caldavAccountsSection";
import { renderCalendarOperationsSection } from "./settings/sections/calendarOperationsSection";
import { renderConnectedCalendarsSection } from "./settings/sections/connectedCalendarsSection";
import { renderDebugSection } from "./settings/sections/debugSection";
import { renderLogSection } from "./settings/sections/logSection";
import { renderNotificationsSection } from "./settings/sections/notificationsSection";
import { renderOutboxSection } from "./settings/sections/outboxSection";
import { renderRecordingSection } from "./settings/sections/recordingSection";
import { renderTranscriptionSection } from "./settings/sections/transcriptionSection";
import { renderVaultFoldersSection } from "./settings/sections/vaultFoldersSection";

/** Вкладка настроек плагина “Ассистент” в Obsidian. */
export class AssistantSettingsTab extends PluginSettingTab {
  /** Ссылка на плагин (доступ к настройкам/логам/командам). */
  plugin: AssistantPlugin;
  private discoveredCaldavCalendars: Record<string, Array<{ displayName: string; url: string; color?: string }>> = {};

  constructor(app: App, plugin: AssistantPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /** Obsidian: отрисовать вкладку настроек. */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Ассистент — Календари" });

    this.renderDebugSection(containerEl);
    this.renderVaultFoldersSection(containerEl);
    this.renderNotificationsSection(containerEl);
    this.renderRecordingSection(containerEl);
    this.renderTranscriptionSection(containerEl);
    this.renderAutoRefreshSection(containerEl);
    this.renderLogSection(containerEl);
    this.renderOutboxSection(containerEl);
    this.renderCaldavAccountsSection(containerEl);
    this.renderConnectedCalendarsSection(containerEl);
    this.renderCalendarOperationsSection(containerEl);
  }

  /**
   * Перерисовать вкладку, сохранив позицию прокрутки.
   * Нужно, чтобы UI не “дёргался” и не прыгал к началу при смене настроек.
   */
  private rerenderPreservingScroll(): void {
    const top = this.containerEl.scrollTop;
    this.display();
    this.containerEl.scrollTop = top;
  }

  private renderDebugSection(containerEl: HTMLElement) {
    renderDebugSection({
      containerEl,
      plugin: this.plugin,
      rerenderPreservingScroll: () => this.rerenderPreservingScroll(),
    });
  }

  private renderVaultFoldersSection(containerEl: HTMLElement) {
    renderVaultFoldersSection({ containerEl, plugin: this.plugin });
  }

  private renderNotificationsSection(containerEl: HTMLElement) {
    renderNotificationsSection({ containerEl, plugin: this.plugin });
  }

  private renderRecordingSection(containerEl: HTMLElement) {
    renderRecordingSection({ containerEl, plugin: this.plugin });
  }

  private renderTranscriptionSection(containerEl: HTMLElement) {
    renderTranscriptionSection({ containerEl, plugin: this.plugin });
  }

  private renderAutoRefreshSection(containerEl: HTMLElement) {
    renderAutoRefreshSection({ containerEl, plugin: this.plugin });
  }

  private renderLogSection(containerEl: HTMLElement) {
    renderLogSection({ containerEl, plugin: this.plugin });
  }

  private renderOutboxSection(containerEl: HTMLElement) {
    renderOutboxSection({
      containerEl,
      plugin: this.plugin,
      rerenderPreservingScroll: () => this.rerenderPreservingScroll(),
    });
  }

  private renderCaldavAccountsSection(containerEl: HTMLElement) {
    renderCaldavAccountsSection({
      containerEl,
      plugin: this.plugin,
      rerenderPreservingScroll: () => this.rerenderPreservingScroll(),
      discoveredCaldavCalendars: this.discoveredCaldavCalendars,
    });
  }

  private renderConnectedCalendarsSection(containerEl: HTMLElement) {
    renderConnectedCalendarsSection({
      containerEl,
      plugin: this.plugin,
      rerenderPreservingScroll: () => this.rerenderPreservingScroll(),
    });
  }

  private renderCalendarOperationsSection(containerEl: HTMLElement) {
    renderCalendarOperationsSection({ containerEl, plugin: this.plugin });
  }
}
