import type { AssistantSettings, CalendarEvent } from "../types";

function isLinux(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyProcess = process as any;
    return anyProcess?.platform === "linux";
  } catch {
    return false;
  }
}

/** Возможные действия пользователя в popup-окне. */
export type PopupAction = "ok" | "create_protocol" | "start_recording" | "cancelled" | "close";

/**
 * Показать popup-окно уведомления через `yad` (только Linux).
 *
 * Возвращает код действия (какую кнопку нажали).
 */
export async function linuxPopupWindow(ev: CalendarEvent, msg: string, settings: AssistantSettings): Promise<PopupAction> {
  if (!isLinux()) throw new Error("Окружение не Linux");

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execFile } = require("child_process") as typeof import("child_process");
  const timeoutSec = Math.max(1, Math.round((settings.notifications.delivery.popup.timeoutMs ?? 20_000) / 1000));

  const details = [
    `Встреча: ${ev.summary}`,
    `Начало: ${ev.start.toLocaleString("ru-RU")}`,
    ev.end ? `Конец: ${ev.end.toLocaleString("ru-RU")}` : "",
    ev.location ? `Место: ${ev.location}` : "",
    ev.url ? `Ссылка: ${ev.url}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const text = `${msg}\n\n${details}`;

  // Предпочитаем yad (надёжно поддерживает поверх окон)
  const code = await execCode(execFile, "yad", [
    "--on-top",
    "--sticky",
    "--skip-taskbar",
    "--center",
    "--title=Ассистент",
    "--width=720",
    "--height=360",
    "--fixed",
    `--timeout=${timeoutSec}`,
    "--text",
    text,
    "--button=Создать протокол:11",
    "--button=Начать запись (позже):10",
    "--button=Встреча отменена:12",
    "--button=ОК:0",
    "--button=Закрыть:1",
  ]);

  if (code === 10) return "start_recording";
  if (code === 11) return "create_protocol";
  if (code === 12) return "cancelled";
  if (code === 0) return "ok";
  return "close";
}

function execCode(execFile: typeof import("child_process").execFile, cmd: string, args: string[]): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    execFile(cmd, args, (err: unknown) => {
      if (!err) return resolve(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyErr = err as any;
      // execFile uses exit code in err.code for non-zero exits
      if (typeof anyErr?.code === "number") return resolve(anyErr.code);
      reject(err);
    });
  });
}
