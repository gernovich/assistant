/**
 * Policy: куда класть протоколы в vault.
 *
 * Правило (фиксированное):
 * - если протокол создаётся из карточки встречи -> `Ассистент/Протоколы/<basename карточки встречи>/...`
 * - если протокол без встречи -> `Ассистент/Протоколы/...`
 *
 * Без миграций: это влияет только на создание новых файлов.
 */
export function protocolTargetDir(params: { protocolsDir: string; meetingFilePath?: string }): string {
  const root = trimTrailingSlashes(String(params.protocolsDir || ""));
  if (!root) return "";

  const meetingBase = meetingBasenameFromPath(params.meetingFilePath);
  if (!meetingBase) return root;
  return joinVaultPath(root, meetingBase);
}

function meetingBasenameFromPath(p?: string): string {
  const path = String(p || "");
  const last = path.split("/").filter(Boolean).pop() ?? "";
  if (!last) return "";
  return last.endsWith(".md") ? last.slice(0, -3) : last;
}

function joinVaultPath(a: string, b: string): string {
  const left = trimTrailingSlashes(a);
  const right = String(b || "").replace(/^\/+/g, "");
  if (!left) return right;
  if (!right) return left;
  return `${left}/${right}`;
}

function trimTrailingSlashes(p: string): string {
  return String(p || "").replace(/\/+$/g, "");
}
