import type { TranscriptSegment } from "./transcriptionTypes";

export function formatHhMmSsMs(totalSeconds: number): string {
  const ms = Math.max(0, Math.floor(Number(totalSeconds) * 1000));
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ss = s % 60;
  const mmm = ms % 1000;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const pad3 = (n: number) => String(n).padStart(3, "0");
  return h > 0 ? `${pad2(h)}:${pad2(mm)}:${pad2(ss)}.${pad3(mmm)}` : `${pad2(mm)}:${pad2(ss)}.${pad3(mmm)}`;
}

export function formatSegmentsMarkdown(params: { segments: TranscriptSegment[]; fileLabel: string }): string {
  const lines: string[] = [];
  lines.push(`#### Расшифровка: ${params.fileLabel}`);
  lines.push("");
  for (const seg of params.segments || []) {
    const start = typeof seg.startSec === "number" ? seg.startSec : 0;
    const end = typeof seg.endSec === "number" ? seg.endSec : start;
    const text = String(seg.text ?? "").trim();
    if (!text) continue;
    lines.push(`- ${formatHhMmSsMs(start)}–${formatHhMmSsMs(end)} ${text}`);
  }
  if (lines.length === 2) {
    lines.push("- (пусто)");
  }
  lines.push("");
  return lines.join("\n");
}

