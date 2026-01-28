import { Setting } from "obsidian";
import type AssistantPlugin from "../../../../main";
import type { CalendarConfig } from "../../../types";
import { createSettingsNotice } from "../helpers";
import { mergeGoogleEventColorLabels } from "../../../domain/policies/googleEventColorLabels";

/**
 * Отрисовать один блок календаря (ICS/CalDAV).
 * Важно: поведение должно совпадать с прежним `AssistantSettingsTab.renderCalendar`.
 */
export function renderCalendarBlock(params: {
  containerEl: HTMLElement;
  plugin: AssistantPlugin;
  cal: CalendarConfig;
  rerenderPreservingScroll: () => void;
}): void {
  const { containerEl, plugin, cal } = params;

  const calHeader = containerEl.createEl("h4", { text: cal.name, cls: "assistant-settings__calendar-title" });

  new Setting(containerEl).setName("Включён").addToggle((t) =>
    t.setValue(cal.enabled).onChange(async (v) => {
      await plugin.applySettingsCommand({ type: "calendar.update", calendarId: cal.id, patch: { enabled: v } });
    }),
  );

  new Setting(containerEl).setName("Имя").addText((t) =>
    t.setValue(cal.name).onChange(async (v) => {
      const name = v.trim() || "Календарь";
      await plugin.applySettingsCommand({ type: "calendar.update", calendarId: cal.id, patch: { name } });
      calHeader.setText(name);
    }),
  );

  new Setting(containerEl)
    .setName("Цвет календаря (сервер)")
    .setDesc(cal.color ? String(cal.color) : "—");

  new Setting(containerEl)
    .setName("Переопределить цвет календаря")
    .setDesc("Если пусто — используется цвет календаря с сервера. Пример: #ff8800")
    .addText((t) =>
      t.setPlaceholder("#999").setValue(String((cal as any).colorOverride ?? "")).onChange(async (v) => {
        await plugin.applySettingsCommand({
          type: "calendar.update",
          calendarId: cal.id,
          patch: { colorOverride: String(v || "").trim() },
        });
      }),
    );

  new Setting(containerEl).setName("Тип").addDropdown((dd) => {
    dd.addOption("ics_url", "ICS URL");
    dd.addOption("caldav", "CalDAV");
    dd.setValue(cal.type);
    dd.onChange(async (v) => {
      const next = v as CalendarConfig["type"];
      if (cal.type === next) return;
      await plugin.applySettingsCommand({ type: "calendar.update", calendarId: cal.id, patch: { type: next } });
      params.rerenderPreservingScroll();
    });
  });

  const hint = createSettingsNotice({ containerEl, variant: "info", title: "ℹ️ Типы календарей и ограничения" });
  const ul = hint.createEl("ul");
  ul.createEl("li", { text: "ICS URL — быстро и просто, но чаще read-only. Подходит для повестки/уведомлений." });
  ul.createEl("li", { text: "CalDAV (WebDAV) — стандарт, часто read/write. Подходит для Nextcloud/iCloud/других." });
  ul.createEl("li", { text: "Для Google рекомендуем CalDAV + OAuth (без Basic)." });

  if (cal.type === "ics_url") {
    new Setting(containerEl)
      .setName("URL ICS")
      .setDesc("Ссылка на .ics (может быть приватной).")
      .addText((t) =>
        t
          .setPlaceholder("https://.../calendar.ics")
          .setValue(cal.url ?? "")
          .onChange(async (v) => {
            await plugin.applySettingsCommand({ type: "calendar.update", calendarId: cal.id, patch: { url: v.trim() } });
          }),
      );
  }

  if (cal.type === "caldav") {
    const accounts = plugin.settings.caldav.accounts;
    const selectedAcc = accounts.find((a) => a.id === (cal.caldav?.accountId ?? ""));

    new Setting(containerEl)
      .setName("CalDAV аккаунт")
      .setDesc("Выберите аккаунт, через который будет читаться этот календарь.")
      .addDropdown((dd) => {
        dd.addOption("", "— не выбран —");
        for (const a of accounts) dd.addOption(a.id, a.name);
        dd.setValue(cal.caldav?.accountId ?? "");
        dd.onChange(async (v) => {
          await plugin.applySettingsCommand({
            type: "calendar.update",
            calendarId: cal.id,
            patch: { caldav: { accountId: v } },
          });
          params.rerenderPreservingScroll();
        });
      });

    const authInfo = containerEl.createDiv();
    if (!selectedAcc) {
      createSettingsNotice({
        containerEl: authInfo,
        variant: "warning",
        title: "⚠️ Авторизация: аккаунт не выбран",
        desc: "Выберите CalDAV аккаунт выше. Для Google рекомендуем OAuth.",
      });
    } else {
      const method = selectedAcc.authMethod ?? "basic";
      const hasToken = Boolean(selectedAcc.oauth?.refreshToken);
      const hasPassword = Boolean(selectedAcc.password);

      if (method === "google_oauth") {
        createSettingsNotice({
          containerEl: authInfo,
          variant: hasToken ? "ok" : "danger",
          title: hasToken ? "✅ Авторизация: Google OAuth — OK" : "⛔ Авторизация: Google OAuth — нет refresh token",
          desc: !hasToken ? "Нажмите «Авторизоваться» в аккаунте CalDAV, чтобы получить refresh‑токен." : undefined,
        });
      } else {
        createSettingsNotice({
          containerEl: authInfo,
          variant: hasPassword ? "ok" : "warning",
          title: hasPassword ? "✅ Авторизация: Basic — пароль задан" : "⚠️ Авторизация: Basic — нет пароля",
          desc: !hasPassword ? "Задайте пароль (или пароль приложения / App password) в аккаунте CalDAV." : undefined,
        });
      }

      if (method === "google_oauth" && !hasToken) {
        new Setting(authInfo)
          .setName("Google OAuth")
          .setDesc("Рекомендуется для Google. Нажмите авторизацию, чтобы получить refresh‑токен.")
          .addButton((b) =>
            b.setButtonText("Авторизоваться").onClick(async () => {
              await plugin.caldavAccounts.authorizeGoogle(selectedAcc.id);
              params.rerenderPreservingScroll();
            }),
          );
      }

      // Google Calendar API: подписи для цветов событий (colorId -> label).
      if (method === "google_oauth" && hasToken) {
        const cur = (cal as any).googleColorLabels as Record<string, string> | undefined;
        const toText = (m?: Record<string, string>) => {
          const entries = Object.entries(m ?? {});
          entries.sort((a, b) => Number(a[0]) - Number(b[0]));
          return entries.map(([k, v]) => `${k}=${v}`).join("\n");
        };
        const merged = mergeGoogleEventColorLabels(cur);
        new Setting(containerEl)
          .setName("Метки цветов Google (для событий)")
          .setDesc("Формат: одна строка = colorId=Название. По умолчанию — стандартные названия Google (Lavender/Sage/…). Можно переопределить.")
          .addTextArea((ta) =>
            ta.setValue(toText(merged)).onChange(async (v) => {
              const out: Record<string, string> = {};
              for (const line of String(v ?? "").split("\n")) {
                const s = line.trim();
                if (!s) continue;
                const idx = s.indexOf("=");
                if (idx <= 0) continue;
                const k = s.slice(0, idx).trim();
                const val = s.slice(idx + 1).trim();
                if (!k || !val) continue;
                out[k] = val;
              }
              await plugin.applySettingsCommand({
                type: "calendar.update",
                calendarId: cal.id,
                patch: { googleColorLabels: Object.keys(out).length ? out : null },
              });
            }),
          );
      }

      // (доп. предупреждения уже показаны выше)
      void method;
      void hasPassword;
      void hasToken;
    }

    new Setting(containerEl)
      .setName("URL календаря")
      .setDesc("URL календаря (обычно оканчивается на /events/ или /). Проще добавить через «Найти календари» выше.")
      .addText((t) =>
        t
          .setPlaceholder("https://.../")
          .setValue(cal.caldav?.calendarUrl ?? "")
          .onChange(async (v) => {
            await plugin.applySettingsCommand({
              type: "calendar.update",
              calendarId: cal.id,
              patch: { caldav: { calendarUrl: v.trim() } },
            });
          }),
      );

    // Для Google OAuth: serverUrl фиксируется на уровне аккаунта (см. секцию аккаунтов).
    // Эта подсказка остаётся в аккаунте; здесь не дублируем.
  }

  new Setting(containerEl)
    .setName("Обновить")
    .setDesc("Принудительно обновить только этот календарь.")
    .addButton((b) =>
      b.setButtonText("Обновить").onClick(async () => {
        await plugin.settingsOps.refreshCalendar(cal.id);
      }),
    );

  new Setting(containerEl).setName("Удалить календарь").addButton((b) =>
    b
      .setButtonText("Удалить")
      .setWarning()
      .onClick(async () => {
        await plugin.applySettingsCommand({ type: "calendar.remove", calendarId: cal.id });
        params.rerenderPreservingScroll();
      }),
  );
}
