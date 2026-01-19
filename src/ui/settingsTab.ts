import { App, PluginSettingTab, Setting } from "obsidian";
import type AssistantPlugin from "../../main";
import type { CalendarConfig } from "../types";
import { CaldavProvider } from "../calendar/providers/caldavProvider";

export class AssistantSettingsTab extends PluginSettingTab {
  plugin: AssistantPlugin;
  private discoveredCaldavCalendars: Record<string, Array<{ displayName: string; url: string; color?: string }>> = {};

  constructor(app: App, plugin: AssistantPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Ассистент — Календари" });

    containerEl.createEl("h3", { text: "Отладка" });

    new Setting(containerEl)
      .setName("Включить отладку")
      .setDesc("Показывает дополнительные элементы: кнопки/панель лога, debug-опции в UI.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.debug.enabled).onChange(async (v) => {
          this.plugin.settings.debug.enabled = v;
          await this.plugin.saveSettingsAndApply();
          this.display();
        }),
      );

    containerEl.createEl("h3", { text: "Папки в vault" });

    new Setting(containerEl)
      .setName("Логи")
      .setDesc("По умолчанию: Ассистент/Логи")
      .addText((t) =>
        t
          .setPlaceholder("Ассистент/Логи")
          .setValue(this.plugin.settings.folders.logs)
          .onChange(async (v) => {
            this.plugin.settings.folders.logs = v.trim() || "Ассистент/Логи";
            await this.plugin.saveSettingsAndApply();
          }),
      );

    new Setting(containerEl)
      .setName("Проекты")
      .setDesc("По умолчанию: Ассистент/Проекты")
      .addText((t) =>
        t
          .setPlaceholder("Ассистент/Проекты")
          .setValue(this.plugin.settings.folders.projects)
          .onChange(async (v) => {
            this.plugin.settings.folders.projects = v.trim() || "Ассистент/Проекты";
            await this.plugin.saveSettingsAndApply();
          }),
      );

    new Setting(containerEl)
      .setName("Люди")
      .setDesc("По умолчанию: Ассистент/Люди")
      .addText((t) =>
        t
          .setPlaceholder("Ассистент/Люди")
          .setValue(this.plugin.settings.folders.people)
          .onChange(async (v) => {
            this.plugin.settings.folders.people = v.trim() || "Ассистент/Люди";
            await this.plugin.saveSettingsAndApply();
          }),
      );

    new Setting(containerEl)
      .setName("Встречи (календарь)")
      .setDesc("По умолчанию: Ассистент/Встречи")
      .addText((t) =>
        t
          .setPlaceholder("Ассистент/Встречи")
          .setValue(this.plugin.settings.folders.calendarEvents)
          .onChange(async (v) => {
            this.plugin.settings.folders.calendarEvents = v.trim() || "Ассистент/Встречи";
            await this.plugin.saveSettingsAndApply();
          }),
      );

    new Setting(containerEl)
      .setName("Протоколы")
      .setDesc("По умолчанию: Ассистент/Протоколы")
      .addText((t) =>
        t
          .setPlaceholder("Ассистент/Протоколы")
          .setValue(this.plugin.settings.folders.protocols)
          .onChange(async (v) => {
            this.plugin.settings.folders.protocols = v.trim() || "Ассистент/Протоколы";
            await this.plugin.saveSettingsAndApply();
          }),
      );

    containerEl.createEl("h3", { text: "Уведомления" });

    new Setting(containerEl)
      .setName("Включить уведомления")
      .setDesc("Показывать напоминания о встречах календаря.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.notifications.enabled).onChange(async (v) => {
          this.plugin.settings.notifications.enabled = v;
          await this.plugin.saveSettingsAndApply();
        }),
      );

    new Setting(containerEl)
      .setName("Уведомлять за (минут)")
      .setDesc("За сколько минут до начала встречи показывать напоминание.")
      .addText((t) =>
        t
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.notifications.minutesBefore))
          .onChange(async (v) => {
            const n = Number(v);
            this.plugin.settings.notifications.minutesBefore = Number.isFinite(n) ? n : 5;
            await this.plugin.saveSettingsAndApply();
          }),
      );

    new Setting(containerEl)
      .setName("Уведомление в момент начала")
      .setDesc("Показывать уведомление, когда встреча началась.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.notifications.atStart).onChange(async (v) => {
          this.plugin.settings.notifications.atStart = v;
          await this.plugin.saveSettingsAndApply();
        }),
      );

    new Setting(containerEl)
      .setName("Способ уведомления")
      .setDesc("Notice / notify-send / popup window (yad).")
      .addDropdown((dd) => {
        dd.addOption("obsidian_notice", "Уведомление Obsidian (Notice)");
        dd.addOption("system_notify_send", "Системное уведомление (notify-send)");
        dd.addOption("popup_window", "Всплывающее окно (yad)");
        dd.setValue(this.plugin.settings.notifications.delivery.method);
        dd.onChange(async (v) => {
          this.plugin.settings.notifications.delivery.method = v as "obsidian_notice" | "system_notify_send" | "popup_window";
          await this.plugin.saveSettingsAndApply();
          this.display();
        });
      });

    if (this.plugin.settings.notifications.delivery.method === "system_notify_send") {
      new Setting(containerEl)
        .setName("Urgency (notify-send)")
        .setDesc("Рекомендуется: critical. Требуется пакет libnotify-bin.")
        .addDropdown((dd) => {
          dd.addOption("low", "low");
          dd.addOption("normal", "normal");
          dd.addOption("critical", "critical");
          dd.setValue(this.plugin.settings.notifications.delivery.system.urgency);
          dd.onChange(async (v) => {
            this.plugin.settings.notifications.delivery.system.urgency = v as "low" | "normal" | "critical";
            await this.plugin.saveSettingsAndApply();
          });
        });

      new Setting(containerEl)
        .setName("Таймаут (мс)")
        .setDesc("Например 20000.")
        .addText((t) =>
          t
            .setPlaceholder("20000")
            .setValue(String(this.plugin.settings.notifications.delivery.system.timeoutMs))
            .onChange(async (v) => {
              const n = Number(v);
              this.plugin.settings.notifications.delivery.system.timeoutMs = Number.isFinite(n) ? n : 20_000;
              await this.plugin.saveSettingsAndApply();
            }),
        );
    }

    if (this.plugin.settings.notifications.delivery.method === "popup_window") {
      new Setting(containerEl)
        .setName("Таймаут окна (мс)")
        .setDesc("Требуется yad. Окно может показываться поверх других окон.")
        .addText((t) =>
          t
            .setPlaceholder("20000")
            .setValue(String(this.plugin.settings.notifications.delivery.popup.timeoutMs))
            .onChange(async (v) => {
              const n = Number(v);
              this.plugin.settings.notifications.delivery.popup.timeoutMs = Number.isFinite(n) ? n : 20_000;
              await this.plugin.saveSettingsAndApply();
            }),
        );
    }

    new Setting(containerEl)
      .setName("Проверить уведомление")
      .setDesc("Показывает тестовое уведомление выбранным способом.")
      .addButton((b) =>
        b.setButtonText("Проверить").onClick(async () => {
          await this.plugin.debugNotifyTest();
        }),
      );

    new Setting(containerEl)
      .setName("Проверить зависимости")
      .setDesc("Проверяет наличие нужных бинарников для выбранного способа уведомлений (notify-send / yad).")
      .addButton((b) =>
        b.setButtonText("Проверить").onClick(async () => {
          const res = await this.plugin.checkNotificationDependencies();
          if (res.ok) this.plugin.logService.info(res.message);
          else this.plugin.logService.warn(res.message);
          // Notice показываем всегда, чтобы результат был виден без панели лога
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { Notice } = require("obsidian") as typeof import("obsidian");
          new Notice(res.message);
        }),
      );

    containerEl.createEl("h3", { text: "Автообновление" });

    new Setting(containerEl)
      .setName("Автообновление календарей")
      .setDesc("Автоматически перечитывать календари по интервалу.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.calendar.autoRefreshEnabled).onChange(async (v) => {
          this.plugin.settings.calendar.autoRefreshEnabled = v;
          await this.plugin.saveSettingsAndApply();
        }),
      );

    new Setting(containerEl)
      .setName("Интервал (минут)")
      .setDesc("Как часто обновлять календари автоматически.")
      .addText((t) =>
        t
          .setPlaceholder("10")
          .setValue(String(this.plugin.settings.calendar.autoRefreshMinutes))
          .onChange(async (v) => {
            const n = Number(v);
            this.plugin.settings.calendar.autoRefreshMinutes = Number.isFinite(n) ? n : 10;
            await this.plugin.saveSettingsAndApply();
          }),
      );

    new Setting(containerEl)
      .setName("Мой email (для статуса приглашений)")
      .setDesc("Используется, чтобы в «Повестке» показывать: принята/не отвечено/отклонена (PARTSTAT из ICS).")
      .addText((t) =>
        t
          .setPlaceholder("me@example.com")
          .setValue(this.plugin.settings.calendar.myEmail)
          .onChange(async (v) => {
            this.plugin.settings.calendar.myEmail = v.trim();
            await this.plugin.saveSettingsAndApply();
          }),
      );

    containerEl.createEl("h3", { text: "Лог" });

    if (this.plugin.settings.debug.enabled) {
      new Setting(containerEl)
        .setName("Открыть панель лога")
        .setDesc("Показать live-лог плагина (удобно для отладки).")
        .addButton((b) =>
          b.setButtonText("Открыть").onClick(async () => {
            await this.plugin.activateLogView();
          }),
        );

      new Setting(containerEl)
        .setName("Открыть сегодняшний лог-файл")
        .setDesc("Открыть markdown лог по дате прямо в Obsidian.")
        .addButton((b) =>
          b.setButtonText("Открыть файл").onClick(async () => {
            await this.plugin.logFileWriter.openTodayLog();
          }),
        );
    } else {
      containerEl.createDiv({
        text: "Кнопки логов скрыты (включите «Отладка» выше).",
        cls: "setting-item-description",
      });
    }

    new Setting(containerEl)
      .setName("Писать лог в vault (md файлы)")
      .setDesc("Сохранять лог в виде markdown-файлов по датам, чтобы их можно было смотреть прямо в Obsidian.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.log.writeToVault).onChange(async (v) => {
          this.plugin.settings.log.writeToVault = v;
          await this.plugin.saveSettingsAndApply();
        }),
      );

    // Папка логов настраивается в "Папки в vault" → "Логи" (settings.folders.logs).

    new Setting(containerEl)
      .setName("Размер лога (строк)")
      .setDesc("Сколько последних записей хранить в панели лога.")
      .addText((t) =>
        t
          .setPlaceholder("200")
          .setValue(String(this.plugin.settings.log.maxEntries))
          .onChange(async (v) => {
            const n = Number(v);
            this.plugin.settings.log.maxEntries = Number.isFinite(n) ? n : 200;
            await this.plugin.saveSettingsAndApply();
          }),
      );

    containerEl.createEl("h3", { text: "Аккаунты (CalDAV)" });

    const accounts = this.plugin.settings.caldav.accounts;
    if (accounts.length === 0) {
      const emptyAcc = containerEl.createDiv({ cls: "assistant-settings__notice assistant-settings__notice--warning" });
      emptyAcc.createDiv({ text: "⚠️ Нет CalDAV аккаунтов", cls: "assistant-settings__notice-title" });
      emptyAcc.createDiv(
        { text: "Добавьте аккаунт CalDAV, чтобы подключать CalDAV календари и использовать OAuth для Google.", cls: "assistant-settings__notice-desc" },
      );
    }

    for (const acc of accounts) {
      const accBlock = containerEl.createDiv({ cls: "assistant-settings__account-block" });

      const accHeader = accBlock.createEl("h4", { text: acc.name, cls: "assistant-settings__calendar-title" });

      new Setting(accBlock).setName("Включён").addToggle((t) =>
        t.setValue(acc.enabled).onChange(async (v) => {
          acc.enabled = v;
          await this.plugin.saveSettingsAndApply();
        }),
      );

      new Setting(accBlock).setName("Имя").addText((t) =>
        t.setValue(acc.name).onChange(async (v) => {
          acc.name = v.trim() || "CalDAV";
          await this.plugin.saveSettingsAndApply();
          accHeader.setText(acc.name);
        }),
      );

      new Setting(accBlock)
        .setName("Auth method")
        .setDesc("Basic для Nextcloud/iCloud; Google OAuth — без пароля (рекомендуется для Google).")
        .addDropdown((dd) => {
          dd.addOption("basic", "Basic");
          dd.addOption("google_oauth", "Google OAuth");
          dd.setValue(acc.authMethod ?? "basic");
          dd.onChange(async (v) => {
            acc.authMethod = v as "basic" | "google_oauth";
            acc.oauth = acc.oauth ?? { clientId: "", clientSecret: "", refreshToken: "" };
            if (acc.authMethod === "google_oauth" && !acc.serverUrl.trim()) {
              acc.serverUrl = GOOGLE_CALDAV_SERVER_URL;
            }
            await this.plugin.saveSettingsAndApply();
            this.display();
          });
        });

      const authMethod = acc.authMethod ?? "basic";

      // Readiness status (helps understand why discovery/sync doesn't work)
      const readiness = getCaldavAccountReadiness(acc);
      const status = accBlock.createDiv({
        cls: `assistant-settings__notice ${readiness.ok ? "assistant-settings__notice--ok" : "assistant-settings__notice--warning"}`,
      });
      status.createDiv({
        text: readiness.ok ? "✅ Аккаунт готов" : "⚠️ Аккаунт не готов",
        cls: "assistant-settings__notice-title",
      });
      if (!readiness.ok) {
        const list = status.createEl("ul");
        for (const r of readiness.reasons) list.createEl("li", { text: r });
      }

      if (authMethod === "basic") {
        const danger = accBlock.createDiv({ cls: "assistant-settings__notice assistant-settings__notice--danger" });
        danger.createDiv({ text: "⛔ Пароль хранится локально", cls: "assistant-settings__notice-title" });
        danger.createDiv({
          text: "Пароль будет сохранён в настройках Obsidian (`.obsidian/plugins/assistant/data.json`). Убедитесь, что `.obsidian` не синхронизируется через git. Для Google рекомендуем OAuth.",
          cls: "assistant-settings__notice-desc",
        });
      }

      if (authMethod === "basic" && isGoogleCaldavUrl(acc.serverUrl)) {
        const warn = accBlock.createDiv({ cls: "assistant-settings__notice assistant-settings__notice--warning" });
        warn.createDiv({ text: "⚠️ Google + Basic: нужен App password", cls: "assistant-settings__notice-title" });
        warn.createDiv({
          text: "Google обычно не принимает обычный пароль по Basic. Если хотите Basic — используйте App password (требует 2FA).",
          cls: "assistant-settings__notice-desc",
        });
        warn.createDiv({ text: "Быстрый доступ:", cls: "assistant-settings__notice-desc" });
        const links = warn.createEl("ul");
        links.createEl("li").createEl("a", {
          text: "App passwords (прямая ссылка)",
          href: "https://myaccount.google.com/apppasswords",
        });
        links.createEl("li").createEl("a", {
          text: "Безопасность Google аккаунта (Security)",
          href: "https://myaccount.google.com/security",
        });

        warn.createDiv({ text: "Пошагово:", cls: "assistant-settings__notice-desc" });
        const steps = warn.createEl("ol");
        steps.createEl("li", {
          text: "Проверьте 2FA: «Google Account → Security → 2-Step Verification» (иначе App passwords недоступны).",
        });
        steps.createEl("li", { text: "Откройте «Пароли приложений / App passwords»." });
        steps.createEl("li", {
          text: "Введите имя приложения (например «Obsidian Assistant») и нажмите «Создать».",
        });
        steps.createEl("li", {
          text: "Скопируйте 16-значный код и используйте его в поле Password (вместо основного пароля).",
        });
        warn.createDiv({
          text: "Если пункта «Пароли приложений» не видно — используйте поиск внутри настроек Google аккаунта: «пароли приложений».",
          cls: "assistant-settings__notice-desc",
        });
        warn.createDiv({ text: "Рекомендуем: Google OAuth (без пароля).", cls: "assistant-settings__notice-desc" });
      }

      if (authMethod === "google_oauth") {
        // Google CalDAV v2: serverUrl должен быть корнем /caldav/v2/ (без email).
        // Дальше discovery сам найдёт principal/homeUrl и calendars (/.../events/).
        const root = GOOGLE_CALDAV_SERVER_URL;
        if (root !== acc.serverUrl) {
          acc.serverUrl = root;
          void this.plugin.saveSettingsAndApply();
        }
        accBlock.createDiv({
          text: `Server URL (Google, fixed): ${root}`,
          cls: "setting-item-description",
        });
      } else {
        new Setting(accBlock)
          .setName("Server URL")
          .setDesc("URL CalDAV сервера (например Nextcloud/iCloud).")
          .addText((t) =>
            t.setPlaceholder("https://...").setValue(acc.serverUrl).onChange(async (v) => {
              acc.serverUrl = v.trim();
              await this.plugin.saveSettingsAndApply();
            }),
          );
      }

      new Setting(accBlock).setName("Login (email)").addText((t) =>
        t.setPlaceholder("me@example.com").setValue(acc.username).onChange(async (v) => {
          acc.username = v.trim();
          await this.plugin.saveSettingsAndApply();
        }),
      );

      if (authMethod === "basic") {
        let passwordInputEl: HTMLInputElement | null = null;
        let passwordVisible = false;

        const passwordSetting = new Setting(accBlock).setName("Password / App password");
        passwordSetting.addText((t) => {
          passwordInputEl = t.inputEl;
          t.inputEl.type = "password";
          t
            .setPlaceholder("••••••••")
            .setValue(acc.password)
            .onChange(async (v) => {
              acc.password = v;
              await this.plugin.saveSettingsAndApply();
            });
        });
        passwordSetting.addExtraButton((b) => {
          b.setIcon("eye").setTooltip("Показать/скрыть пароль");
          b.onClick(() => {
            passwordVisible = !passwordVisible;
            if (passwordInputEl) passwordInputEl.type = passwordVisible ? "text" : "password";
            b.setIcon(passwordVisible ? "eye-off" : "eye");
          });
        });

        if (isGoogleCaldavUrl(acc.serverUrl)) {
          accBlock.createDiv({
            text: "Подсказка (Google): App password обычно показывается с пробелами, но вводить нужно без пробелов (16 символов подряд).",
            cls: "setting-item-description",
          });
        }
      } else {
        const oauth = acc.oauth ?? { clientId: "", clientSecret: "", refreshToken: "" };

        const doc = accBlock.createDiv({ cls: "assistant-settings__notice assistant-settings__notice--info" });
        doc.createDiv({ text: "ℹ️ Где взять Client ID / Client Secret", cls: "assistant-settings__notice-title" });
        const ul = doc.createEl("ul");
        ul.createEl("li", { text: "Открой Google Cloud Console → APIs & Services → Credentials." });
        ul.createEl("li", { text: "Создай OAuth Client ID типа “Desktop app” (для loopback 127.0.0.1)." });
        ul.createEl("li", { text: "Скопируй Client ID и Client Secret сюда." });

        new Setting(accBlock)
          .setName("Google OAuth clientId")
          .setDesc("OAuth Client ID (рекомендуется тип: Desktop app).")
          .addText((t) =>
            t.setPlaceholder("...apps.googleusercontent.com").setValue(oauth.clientId).onChange(async (v) => {
              oauth.clientId = v.trim();
              acc.oauth = oauth;
              await this.plugin.saveSettingsAndApply();
            }),
          );

        new Setting(accBlock)
          .setName("Google OAuth clientSecret")
          .setDesc("Client Secret из Google Cloud (для Desktop app выдаётся).")
          .addText((t) => {
            // placeholder - will be replaced below (we need access to the Setting to add extra button)
            t.setPlaceholder("••••••••");
          });

        // Re-render the clientSecret field as password with eye toggle (keeping layout consistent)
        // NOTE: We intentionally create a dedicated Setting to have access to addExtraButton.
        // (Obsidian Setting API doesn't expose the current Setting inside addText callback)
        accBlock.lastElementChild?.remove();

        let secretInputEl: HTMLInputElement | null = null;
        let secretVisible = false;
        const secretSetting = new Setting(accBlock)
          .setName("Google OAuth clientSecret")
          .setDesc("Client Secret из Google Cloud (для Desktop app выдаётся).");
        secretSetting.addText((t) => {
          secretInputEl = t.inputEl;
          t.inputEl.type = "password";
          t.setPlaceholder("••••••••").setValue(oauth.clientSecret).onChange(async (v) => {
            oauth.clientSecret = v.trim();
            acc.oauth = oauth;
            await this.plugin.saveSettingsAndApply();
          });
        });
        secretSetting.addExtraButton((b) => {
          b.setIcon("eye").setTooltip("Показать/скрыть secret");
          b.onClick(() => {
            secretVisible = !secretVisible;
            if (secretInputEl) secretInputEl.type = secretVisible ? "text" : "password";
            b.setIcon(secretVisible ? "eye-off" : "eye");
          });
        });

        accBlock.createDiv({
          text: oauth.refreshToken ? "Refresh token: сохранён" : "Refresh token: отсутствует",
          cls: "setting-item-description",
        });

        new Setting(accBlock)
          .setName("Авторизация Google CalDAV")
          .setDesc("Откроет браузер, получит refresh token и сохранит локально. Нужен доступ к 127.0.0.1.")
          .addButton((b) =>
            b.setButtonText("Авторизоваться").onClick(async () => {
              await this.plugin.authorizeGoogleCaldav(acc.id);
              this.display();
            }),
          )
          .addButton((b) =>
            b.setButtonText("Сбросить токен").setWarning().onClick(async () => {
              oauth.refreshToken = "";
              acc.oauth = oauth;
              await this.plugin.saveSettingsAndApply();
              this.display();
            }),
          );

        // serverUrl for Google is auto-filled and shown above
      }

      new Setting(accBlock)
        .setName("Найти календари")
        .setDesc("Делает discovery на сервере и показывает список календарей для добавления.")
        .addButton((b) =>
          b.setButtonText("Найти").onClick(async () => {
            const nowReady = getCaldavAccountReadiness(acc);
            if (!nowReady.ok) {
              this.plugin.logService.warn("CalDAV: аккаунт не готов для discovery", { account: acc.name, reasons: nowReady.reasons });
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { Notice } = require("obsidian") as typeof import("obsidian");
              new Notice(`Ассистент: CalDAV аккаунт не готов: ${nowReady.reasons[0] ?? "проверьте настройки"}`);
              return;
            }
            try {
              const provider = new CaldavProvider(this.plugin.settings);
              const found = await provider.discoverCalendars(acc.id);
              this.discoveredCaldavCalendars[acc.id] = found.filter((c) => c.url);
              this.plugin.logService.info("CalDAV: найдено календарей", { count: found.length, account: acc.name });
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { Notice } = require("obsidian") as typeof import("obsidian");
              new Notice(
                `Ассистент: найдено календарей: ${found.length}. ` +
                  `Прокрутите ниже к «Найденные календари» и нажмите «Добавить» напротив нужного.`,
              );
              this.display();
            } catch (e) {
              const raw = String((e as unknown) ?? "unknown");
              const reason = raw.length > 160 ? `${raw.slice(0, 160)}…` : raw;
              this.plugin.logService.error("CalDAV: discovery ошибка", { error: raw });
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { Notice } = require("obsidian") as typeof import("obsidian");
              new Notice(`Ассистент: CalDAV discovery не удался: ${reason}. Подробности в логе.`);
            }
          }),
        );

      const discovered = this.discoveredCaldavCalendars[acc.id] ?? [];
      if (discovered.length > 0) {
        accBlock.createDiv({ text: "Найденные календари:", cls: "setting-item-description" });
        const login = acc.username.trim().toLowerCase();
        const sorted = discovered.slice().sort((a, b) => {
          const aIsPrimary = login && a.displayName.trim().toLowerCase() === login;
          const bIsPrimary = login && b.displayName.trim().toLowerCase() === login;
          if (aIsPrimary !== bIsPrimary) return aIsPrimary ? -1 : 1;
          return a.displayName.localeCompare(b.displayName, "ru");
        });

        for (const c of sorted) {
          const isPrimary = login && c.displayName.trim().toLowerCase() === login;
          const isHoliday = c.displayName.toLowerCase().includes("праздник");
          new Setting(accBlock)
            .setName(isPrimary ? `✅ Основной: ${c.displayName}` : c.displayName)
            .setDesc(c.url)
            .addButton((b) =>
              b.setButtonText(isHoliday ? "Добавить (необязательно)" : "Добавить").onClick(async () => {
                this.plugin.settings.calendars.push({
                  id: newId(),
                  name: c.displayName || "Календарь",
                  type: "caldav",
                  enabled: true,
                  caldav: {
                    accountId: acc.id,
                    calendarUrl: c.url,
                  },
                  color: c.color,
                });
                await this.plugin.saveSettingsAndApply();
                this.display();
              }),
            );
        }
      }

      new Setting(accBlock)
        .setName("Удалить аккаунт")
        .setDesc("Удалит аккаунт и выключит связанные календари (их можно удалить отдельно ниже).")
        .addButton((b) =>
          b.setButtonText("Удалить").setWarning().onClick(async () => {
            this.plugin.settings.caldav.accounts = this.plugin.settings.caldav.accounts.filter((a) => a.id !== acc.id);
            // не удаляем календари автоматически (чтобы не терять конфиг), но выключим
            for (const cal of this.plugin.settings.calendars) {
              if (cal.type === "caldav" && cal.caldav?.accountId === acc.id) cal.enabled = false;
            }
            delete this.discoveredCaldavCalendars[acc.id];
            await this.plugin.saveSettingsAndApply();
            this.display();
          }),
        );
    }

    new Setting(containerEl)
      .setName("Добавить CalDAV аккаунт")
      .setDesc("Добавляет новый CalDAV аккаунт (можно выбрать Basic или Google OAuth).")
      .addButton((b) =>
        b.setButtonText("Добавить").onClick(async () => {
          this.plugin.settings.caldav.accounts.push({
            id: newId(),
            name: "CalDAV",
            enabled: true,
            serverUrl: "",
            username: "",
            password: "",
            authMethod: "basic",
          });
          await this.plugin.saveSettingsAndApply();
          this.display();
        }),
      );

    containerEl.createEl("h3", { text: "Подключенные календари" });

    const cals = this.plugin.settings.calendars;
    if (cals.length === 0) {
      const empty = containerEl.createDiv({ cls: "assistant-settings__notice assistant-settings__notice--warning" });
      empty.createDiv({ text: "⚠️ Нет подключенных календарей", cls: "assistant-settings__notice-title" });
      empty.createDiv({
        text: "Добавьте календарь (ICS URL или CalDAV), чтобы появились встречи в «Повестке» и уведомления.",
        cls: "assistant-settings__notice-desc",
      });
    }

    for (const cal of cals) {
      const block = containerEl.createDiv({ cls: "assistant-settings__calendar-block" });
      this.renderCalendar(block, cal);
    }

    new Setting(containerEl)
      .setName("Добавить календарь")
      .setDesc("Добавляет новый календарь. По умолчанию: ICS URL.")
      .addButton((b) =>
        b.setButtonText("Добавить").onClick(async () => {
          this.plugin.settings.calendars.push({
            id: newId(),
            name: "Календарь",
            type: "ics_url",
            enabled: true,
            url: "",
          });
          await this.plugin.saveSettingsAndApply();
          this.display();
        }),
      );

    containerEl.createEl("h3", { text: "Операции с календарями" });

    new Setting(containerEl)
      .setName("Обновить календари")
      .setDesc("Скачать встречи заново.")
      .addButton((b) =>
        b.setButtonText("Обновить").onClick(async () => {
          await this.plugin.refreshCalendars();
        }),
      );
  }

  private renderCalendar(containerEl: HTMLElement, cal: CalendarConfig) {
    const calHeader = containerEl.createEl("h4", { text: cal.name, cls: "assistant-settings__calendar-title" });

    new Setting(containerEl)
      .setName("Включён")
      .addToggle((t) =>
        t.setValue(cal.enabled).onChange(async (v) => {
          cal.enabled = v;
          await this.plugin.saveSettingsAndApply();
        }),
      );

    new Setting(containerEl)
      .setName("Имя")
      .addText((t) =>
        t.setValue(cal.name).onChange(async (v) => {
          cal.name = v.trim() || "Календарь";
          await this.plugin.saveSettingsAndApply();
          calHeader.setText(cal.name);
        }),
      );

    new Setting(containerEl)
      .setName("Тип")
      .addDropdown((dd) => {
        dd.addOption("ics_url", "ICS URL");
        dd.addOption("caldav", "CalDAV");
        dd.setValue(cal.type);
        dd.onChange(async (v) => {
          const next = v as CalendarConfig["type"];
          if (cal.type === next) return;
          cal.type = next;
          if (next === "ics_url") {
            cal.url = cal.url ?? "";
            cal.caldav = undefined;
          } else if (next === "caldav") {
            cal.caldav = cal.caldav ?? { accountId: "", calendarUrl: "" };
            cal.url = undefined;
          }
          await this.plugin.saveSettingsAndApply();
          this.display();
        });
      });

    const hint = containerEl.createDiv({ cls: "assistant-settings__notice assistant-settings__notice--info" });
    hint.createDiv({ text: "ℹ️ Типы календарей и ограничения", cls: "assistant-settings__notice-title" });
    const ul = hint.createEl("ul");
    ul.createEl("li", { text: "ICS URL — быстро и просто, но чаще read-only. Подходит для повестки/уведомлений." });
    ul.createEl("li", { text: "CalDAV (WebDAV) — стандарт, часто read/write. Подходит для Nextcloud/iCloud/других." });
    ul.createEl("li", { text: "Для Google рекомендуем CalDAV + OAuth (без Basic)." });

    if (cal.type === "ics_url") {
      new Setting(containerEl)
        .setName("ICS URL")
        .setDesc("Ссылка на .ics (может быть приватной).")
        .addText((t) =>
          t.setPlaceholder("https://.../calendar.ics").setValue(cal.url ?? "").onChange(async (v) => {
            cal.url = v.trim();
            await this.plugin.saveSettingsAndApply();
          }),
        );
    }

    if (cal.type === "caldav") {
      const accounts = this.plugin.settings.caldav.accounts;
      const selectedAcc = accounts.find((a) => a.id === (cal.caldav?.accountId ?? ""));

      new Setting(containerEl)
        .setName("CalDAV аккаунт")
        .setDesc("Выберите аккаунт, через который будет читаться этот календарь.")
        .addDropdown((dd) => {
          dd.addOption("", "— не выбран —");
          for (const a of accounts) dd.addOption(a.id, a.name);
          dd.setValue(cal.caldav?.accountId ?? "");
          dd.onChange(async (v) => {
            cal.caldav = cal.caldav ?? { accountId: "", calendarUrl: "" };
            cal.caldav.accountId = v;
            await this.plugin.saveSettingsAndApply();
            this.display();
          });
        });

      const authInfo = containerEl.createDiv();
      if (!selectedAcc) {
        const n = authInfo.createDiv({ cls: "assistant-settings__notice assistant-settings__notice--warning" });
        n.createDiv({ text: "⚠️ Авторизация: аккаунт не выбран", cls: "assistant-settings__notice-title" });
        n.createDiv({ text: "Выберите CalDAV аккаунт выше. Для Google рекомендуем OAuth.", cls: "assistant-settings__notice-desc" });
      } else {
        const method = selectedAcc.authMethod ?? "basic";
        const hasToken = Boolean(selectedAcc.oauth?.refreshToken);
        const hasPassword = Boolean(selectedAcc.password);

        if (method === "google_oauth") {
          const n = authInfo.createDiv({
            cls: `assistant-settings__notice ${hasToken ? "assistant-settings__notice--ok" : "assistant-settings__notice--danger"}`,
          });
          n.createDiv(
            { text: hasToken ? "✅ Авторизация: Google OAuth — OK" : "⛔ Авторизация: Google OAuth — нет refresh token", cls: "assistant-settings__notice-title" },
          );
          if (!hasToken) {
            n.createDiv({ text: "Нажмите «Авторизоваться» в аккаунте CalDAV, чтобы получить refresh token.", cls: "assistant-settings__notice-desc" });
          }
        } else {
          const n = authInfo.createDiv({
            cls: `assistant-settings__notice ${hasPassword ? "assistant-settings__notice--ok" : "assistant-settings__notice--warning"}`,
          });
          n.createDiv(
            { text: hasPassword ? "✅ Авторизация: Basic — пароль задан" : "⚠️ Авторизация: Basic — нет пароля", cls: "assistant-settings__notice-title" },
          );
          if (!hasPassword) {
            n.createDiv({ text: "Задайте пароль (или App password) в аккаунте CalDAV.", cls: "assistant-settings__notice-desc" });
          }
        }

        if (method === "google_oauth" && !hasToken) {
          new Setting(authInfo)
            .setName("Google OAuth")
            .setDesc("Рекомендуется для Google. Нажмите авторизацию, чтобы получить refresh token.")
            .addButton((b) =>
              b.setButtonText("Авторизоваться").onClick(async () => {
                await this.plugin.authorizeGoogleCaldav(selectedAcc.id);
                this.display();
              }),
            );
        }

        // (доп. предупреждения уже показаны выше)
      }

      new Setting(containerEl)
        .setName("Calendar URL")
        .setDesc("URL calendar collection (обычно оканчивается на /events/ или /). Проще добавить через discovery выше.")
        .addText((t) =>
          t.setPlaceholder("https://.../").setValue(cal.caldav?.calendarUrl ?? "").onChange(async (v) => {
            cal.caldav = cal.caldav ?? { accountId: "", calendarUrl: "" };
            cal.caldav.calendarUrl = v.trim();
            await this.plugin.saveSettingsAndApply();
          }),
        );
    }

    new Setting(containerEl)
      .setName("Обновить")
      .setDesc("Принудительно обновить только этот календарь.")
      .addButton((b) =>
        b.setButtonText("Обновить").onClick(async () => {
          await this.plugin.refreshCalendar(cal.id);
        }),
      );

    new Setting(containerEl)
      .setName("Удалить календарь")
      .addButton((b) =>
        b.setButtonText("Удалить").setWarning().onClick(async () => {
          this.plugin.settings.calendars = this.plugin.settings.calendars.filter((c) => c.id !== cal.id);
          await this.plugin.saveSettingsAndApply();
          this.display();
        }),
      );
  }
}

function getCaldavAccountReadiness(acc: {
  enabled: boolean;
  serverUrl: string;
  username: string;
  password: string;
  authMethod?: "basic" | "google_oauth";
  oauth?: { clientId: string; clientSecret: string; refreshToken: string };
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!acc.enabled) reasons.push("Аккаунт выключен");

  const method = acc.authMethod ?? "basic";
  if (!acc.serverUrl.trim()) reasons.push("Не задан Server URL");
  if (!acc.username.trim()) reasons.push("Не задан Login (email)");

  if (method === "basic") {
    if (!acc.password) reasons.push("Не задан Password / App password");
  } else {
    const oauth = acc.oauth ?? { clientId: "", clientSecret: "", refreshToken: "" };
    if (!oauth.clientId.trim()) reasons.push("Не задан Google OAuth clientId");
    if (!oauth.clientSecret.trim()) reasons.push("Не задан Google OAuth clientSecret");
    if (!oauth.refreshToken.trim()) reasons.push("Нет refresh token — нажмите «Авторизоваться»");
  }

  return { ok: reasons.length === 0, reasons };
}

const GOOGLE_CALDAV_SERVER_URL = "https://apidata.googleusercontent.com/caldav/v2/";

function isGoogleCaldavUrl(url: string): boolean {
  const u = (url ?? "").trim();
  if (!u) return false;
  return u.includes("apidata.googleusercontent.com/caldav/v2");
}

function newId(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyCrypto = crypto as any;
  if (anyCrypto?.randomUUID) return anyCrypto.randomUUID();
  return `cal_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

