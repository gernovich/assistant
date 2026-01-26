/**
 * Политика: базовое имя файла карточки человека (до sanitize/unique).
 */
export function personCardBaseName(params: { displayName?: string; email?: string }): string {
  const dn = String(params.displayName ?? "").trim();
  if (dn) return dn;
  const email = String(params.email ?? "").trim();
  if (email.includes("@")) {
    const local = email.split("@")[0] ?? "";
    const s = local.trim();
    if (s) return s;
  }
  return email || "Новый человек";
}
