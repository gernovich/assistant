import { Setting } from "obsidian";
import type AssistantPlugin from "../../../../main";
import { getCaldavAccountReadiness } from "../../../caldav/caldavReadiness";
import {
  addPasswordSettingWithEye,
  createSettingsNotice,
  GOOGLE_CALDAV_SERVER_URL,
  isGoogleCaldavUrl,
  noticeAddDescLine,
  noticeAddLinks,
  noticeAddList,
  noticeAddOrderedList,
  showNotice,
} from "../helpers";

type DiscoveredCalendarsByAccountId = Record<string, Array<{ displayName: string; url: string; color?: string }>>;

/** Отрисовать секцию настроек: Аккаунты (CalDAV). */
export function renderCaldavAccountsSection(params: {
  containerEl: HTMLElement;
  plugin: AssistantPlugin;
  rerenderPreservingScroll: () => void;
  discoveredCaldavCalendars: DiscoveredCalendarsByAccountId;
}): void {
  const { containerEl, plugin, discoveredCaldavCalendars } = params;

  containerEl.createEl("h3", { text: "Аккаунты (CalDAV)" });

  const accounts = plugin.settings.caldav.accounts;
  if (accounts.length === 0) {
    createSettingsNotice({
      containerEl,
      variant: "warning",
      title: "⚠️ Нет CalDAV аккаунтов",
      desc: "Добавьте аккаунт CalDAV, чтобы подключать CalDAV календари и использовать OAuth для Google.",
    });
  }

  for (const acc of accounts) {
    const accBlock = containerEl.createDiv({ cls: "assistant-settings__account-block" });

    const accHeader = accBlock.createEl("h4", { text: acc.name, cls: "assistant-settings__calendar-title" });

    new Setting(accBlock).setName("Включён").addToggle((t) =>
      t.setValue(acc.enabled).onChange(async (v) => {
        await plugin.caldavAccounts.updateAccount(acc.id, { enabled: v });
      }),
    );

    new Setting(accBlock).setName("Имя").addText((t) =>
      t.setValue(acc.name).onChange(async (v) => {
        const name = v.trim() || "CalDAV";
        await plugin.caldavAccounts.updateAccount(acc.id, { name });
        accHeader.setText(name);
      }),
    );

    new Setting(accBlock)
      .setName("Тип авторизации")
      .setDesc("Basic для Nextcloud/iCloud; Google OAuth — без пароля (рекомендуется для Google).")
      .addDropdown((dd) => {
        dd.addOption("basic", "Basic (логин/пароль)");
        dd.addOption("google_oauth", "Google OAuth (через браузер)");
        dd.setValue(acc.authMethod ?? "basic");
        dd.onChange(async (v) => {
          await plugin.caldavAccounts.updateAccount(acc.id, { authMethod: v as "basic" | "google_oauth" });
          params.rerenderPreservingScroll();
        });
      });

    const authMethod = acc.authMethod ?? "basic";

    // Статус “готовности” (помогает понять, почему discovery/sync не работают).
    const readiness = getCaldavAccountReadiness(acc);
    const status = createSettingsNotice({
      containerEl: accBlock,
      variant: readiness.ok ? "ok" : "warning",
      title: readiness.ok ? "✅ Аккаунт готов" : "⚠️ Аккаунт не готов",
    });
    if (!readiness.ok) {
      const list = status.createEl("ul");
      for (const r of readiness.reasons) list.createEl("li", { text: r });
    }

    if (authMethod === "basic") {
      createSettingsNotice({
        containerEl: accBlock,
        variant: "danger",
        title: "⛔ Пароль хранится локально",
        desc: "Пароль будет сохранён в настройках Obsidian (`.obsidian/plugins/assistant/data.json`). Убедитесь, что `.obsidian` не синхронизируется через git. Для Google рекомендуем OAuth.",
      });
    }

    if (authMethod === "basic" && isGoogleCaldavUrl(acc.serverUrl)) {
      const warn = createSettingsNotice({
        containerEl: accBlock,
        variant: "warning",
        title: "⚠️ Google + Basic: нужен пароль приложения",
        desc: "Google обычно не принимает обычный пароль по Basic. Если хотите Basic — используйте пароль приложения (App password; требует 2FA).",
      });

      noticeAddDescLine(warn, "Быстрый доступ:");
      noticeAddLinks(warn, [
        { text: "Пароли приложений (App passwords, прямая ссылка)", href: "https://myaccount.google.com/apppasswords" },
        { text: "Раздел безопасности Google аккаунта (Security)", href: "https://myaccount.google.com/security" },
      ]);

      noticeAddDescLine(warn, "Пошагово:");
      noticeAddOrderedList(warn, [
        "Проверьте 2FA (двухэтапная аутентификация): «Google Account → Security → 2-Step Verification» (иначе App passwords недоступны).",
        "Откройте «Пароли приложений (App passwords)».",
        "Введите имя приложения (например «Obsidian Assistant») и нажмите «Создать».",
        "Скопируйте 16-значный код и используйте его в поле «Пароль / пароль приложения» (вместо основного пароля).",
      ]);

      noticeAddDescLine(
        warn,
        "Если пункта «Пароли приложений» не видно — используйте поиск внутри настроек Google аккаунта: «пароли приложений».",
      );
      noticeAddDescLine(warn, "Рекомендуем: Google OAuth (без пароля).");
    }

    if (authMethod === "google_oauth") {
      // Google CalDAV v2: serverUrl должен быть корнем /caldav/v2/ (без email).
      // Дальше discovery сам найдёт principal/homeUrl и calendars (/.../events/).
      const root = GOOGLE_CALDAV_SERVER_URL;
      if (root !== acc.serverUrl) {
        void plugin.caldavAccounts.updateAccount(acc.id, { authMethod: "google_oauth", serverUrl: root });
      }
      accBlock.createDiv({
        text: `URL сервера (Google, фиксированный): ${root}`,
        cls: "setting-item-description",
      });
    } else {
      new Setting(accBlock)
        .setName("URL сервера")
        .setDesc("URL CalDAV сервера (например Nextcloud/iCloud).")
        .addText((t) =>
          t
            .setPlaceholder("https://...")
            .setValue(acc.serverUrl)
            .onChange(async (v) => {
              await plugin.caldavAccounts.updateAccount(acc.id, { serverUrl: v.trim() });
            }),
        );
    }

    new Setting(accBlock).setName("Логин (email)").addText((t) =>
      t
        .setPlaceholder("me@example.com")
        .setValue(acc.username)
        .onChange(async (v) => {
          await plugin.caldavAccounts.updateAccount(acc.id, { username: v.trim() });
        }),
    );

    if (authMethod === "basic") {
      addPasswordSettingWithEye({
        containerEl: accBlock,
        name: "Пароль / пароль приложения",
        value: acc.password,
        onChange: async (v) => {
          await plugin.caldavAccounts.updateAccount(acc.id, { password: v });
        },
        tooltip: "Показать/скрыть пароль",
      });

      if (isGoogleCaldavUrl(acc.serverUrl)) {
        accBlock.createDiv({
          text: "Подсказка (Google): пароль приложения (App password) часто показывается с пробелами, но вводить нужно без пробелов (16 символов подряд).",
          cls: "setting-item-description",
        });
      }
    } else {
      const oauth = acc.oauth ?? { clientId: "", clientSecret: "", refreshToken: "" };

      const doc = createSettingsNotice({ containerEl: accBlock, variant: "info", title: "ℹ️ Где взять Client ID / Client Secret" });
      noticeAddList(doc, [
        "Открой Google Cloud Console → APIs & Services → Credentials.",
        "Создай OAuth Client ID типа “Desktop app” (для loopback 127.0.0.1).",
        "Скопируй Client ID и Client Secret сюда.",
      ]);

      new Setting(accBlock)
        .setName("Google OAuth Client ID (clientId)")
        .setDesc("OAuth Client ID (рекомендуется тип приложения: Desktop app).")
        .addText((t) =>
          t
            .setPlaceholder("...apps.googleusercontent.com")
            .setValue(oauth.clientId)
            .onChange(async (v) => {
              await plugin.caldavAccounts.updateAccount(acc.id, { oauth: { clientId: v.trim() } });
            }),
        );

      addPasswordSettingWithEye({
        containerEl: accBlock,
        name: "Google OAuth Client Secret (clientSecret)",
        desc: "Client Secret из Google Cloud (для Desktop app выдаётся).",
        value: oauth.clientSecret,
        onChange: async (v) => {
          await plugin.caldavAccounts.updateAccount(acc.id, { oauth: { clientSecret: v.trim() } });
        },
        tooltip: "Показать/скрыть secret",
      });

      accBlock.createDiv({
        text: oauth.refreshToken ? "refresh‑токен: сохранён" : "refresh‑токен: отсутствует",
        cls: "setting-item-description",
      });

      new Setting(accBlock)
        .setName("Авторизация Google CalDAV")
        .setDesc("Откроет браузер, получит refresh token и сохранит локально. Нужен доступ к 127.0.0.1.")
        .addButton((b) =>
          b.setButtonText("Авторизоваться").onClick(async () => {
            await plugin.caldavAccounts.authorizeGoogle(acc.id);
            params.rerenderPreservingScroll();
          }),
        )
        .addButton((b) =>
          b
            .setButtonText("Сбросить токен")
            .setWarning()
            .onClick(async () => {
              await plugin.caldavAccounts.updateAccount(acc.id, { resetRefreshToken: true });
              params.rerenderPreservingScroll();
            }),
        );
    }

    new Setting(accBlock)
      .setName("Найти календари")
      .setDesc("Делает discovery на сервере и показывает список календарей для добавления.")
      .addButton((b) =>
        b.setButtonText("Найти").onClick(async () => {
          const nowReady = getCaldavAccountReadiness(acc);
          if (!nowReady.ok) {
            showNotice(`Ассистент: CalDAV аккаунт не готов: ${nowReady.reasons[0] ?? "проверьте настройки"}`);
            return;
          }
          try {
            const found = await plugin.caldavAccounts.discover(acc.id);
            discoveredCaldavCalendars[acc.id] = found.filter((c) => c.url);
            showNotice(
              `Ассистент: найдено календарей: ${found.length}. ` +
                `Прокрутите ниже к «Найденные календари» и нажмите «Добавить» напротив нужного.`,
            );
            params.rerenderPreservingScroll();
          } catch (e) {
            const raw = String((e as unknown) ?? "неизвестная ошибка");
            const reason = raw.length > 160 ? `${raw.slice(0, 160)}…` : raw;
            showNotice(`Ассистент: CalDAV discovery не удался: ${reason}. Подробности в логе.`);
          }
        }),
      );

    const discovered = discoveredCaldavCalendars[acc.id] ?? [];
    if (discovered.length > 0) {
      accBlock.createDiv({ text: "Найденные календари:", cls: "setting-item-description" });
      const login = acc.username.trim().toLowerCase();
      const addedUrls = new Set(
        plugin.settings.calendars
          .filter((c) => c.type === "caldav" && c.caldav?.accountId === acc.id)
          .map((c) => c.caldav?.calendarUrl)
          .filter((u): u is string => Boolean(u)),
      );
      const sorted = discovered.slice().sort((a, b) => {
        const aIsPrimary = login && a.displayName.trim().toLowerCase() === login;
        const bIsPrimary = login && b.displayName.trim().toLowerCase() === login;
        if (aIsPrimary !== bIsPrimary) return aIsPrimary ? -1 : 1;
        return a.displayName.localeCompare(b.displayName, "ru");
      });

      for (const c of sorted) {
        const isPrimary = login && c.displayName.trim().toLowerCase() === login;
        const isAdded = addedUrls.has(c.url);
        const titleBase = isPrimary ? `Основной: ${c.displayName}` : c.displayName;
        const title = isAdded ? `✅ ${titleBase}` : titleBase;
        new Setting(accBlock)
          .setName(title)
          .setDesc(c.url)
          .addButton((b) =>
            b
              .setButtonText(isAdded ? "Добавлен" : "Добавить")
              .setDisabled(isAdded)
              .onClick(async () => {
                if (isAdded) return;
                await plugin.caldavAccounts.addCalendarFromDiscovery({
                  name: c.displayName || "Календарь",
                  accountId: acc.id,
                  calendarUrl: c.url,
                  color: c.color,
                });
                params.rerenderPreservingScroll();
              }),
          );
      }
    }

    new Setting(accBlock)
      .setName("Удалить аккаунт")
      .setDesc("Удалит аккаунт и выключит связанные календари (их можно удалить отдельно ниже).")
      .addButton((b) =>
        b
          .setButtonText("Удалить")
          .setWarning()
          .onClick(async () => {
          await plugin.caldavAccounts.removeAccount(acc.id);
          delete discoveredCaldavCalendars[acc.id];
            params.rerenderPreservingScroll();
          }),
      );
  }

  new Setting(containerEl)
    .setName("Добавить CalDAV аккаунт")
    .setDesc("Добавляет новый CalDAV аккаунт (можно выбрать Basic или Google OAuth).")
    .addButton((b) =>
      b.setButtonText("Добавить").onClick(async () => {
        await plugin.caldavAccounts.addAccount();
        params.rerenderPreservingScroll();
      }),
    );
}
