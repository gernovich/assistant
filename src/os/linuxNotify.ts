import type { AssistantSettings } from "../types";

export function canUseLinuxNotifySend(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyProcess = process as any;
    return anyProcess?.platform === "linux";
  } catch {
    return false;
  }
}

export async function linuxNotifySend(title: string, body: string, settings: AssistantSettings): Promise<void> {
  if (!canUseLinuxNotifySend()) return;

  // Lazy import: keep tests/other environments safe.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execFile } = require("child_process") as typeof import("child_process");

  const urgency = settings.notifications.delivery.system.urgency ?? "critical";
  const timeoutMs = Math.max(1000, Number(settings.notifications.delivery.system.timeoutMs ?? 20_000));

  await new Promise<void>((resolve, reject) => {
    execFile(
      "notify-send",
      ["-u", urgency, "-t", String(timeoutMs), title, body],
      (err: unknown) => (err ? reject(err) : resolve()),
    );
  });
}

