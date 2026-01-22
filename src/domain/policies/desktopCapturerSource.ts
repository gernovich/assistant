/**
 * Policy: выбор desktopCapturer source (эвристика по имени окна/экрана).
 */

export type DesktopCapturerSourceLike = { id?: unknown; name?: unknown };

export function pickDesktopCapturerSourceId(sources: DesktopCapturerSourceLike[]): string | null {
  if (!Array.isArray(sources) || sources.length === 0) return null;
  const pick =
    sources.find((s) => /chrome|chromium|brave|firefox|yandex/i.test(String((s as any)?.name ?? ""))) ??
    sources.find((s) => /screen|entire/i.test(String((s as any)?.name ?? ""))) ??
    sources[0];
  const id = String((pick as any)?.id ?? "").trim();
  return id || null;
}

