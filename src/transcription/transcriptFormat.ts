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

/**
 * Форматирует время в формате SRT (00:00:00,000)
 */
export function formatSrtTime(totalSeconds: number): string {
  const ms = Math.max(0, Math.floor(Number(totalSeconds) * 1000));
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ss = s % 60;
  const mmm = ms % 1000;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const pad3 = (n: number) => String(n).padStart(3, "0");
  return `${pad2(h)}:${pad2(mm)}:${pad2(ss)},${pad3(mmm)}`;
}

export function formatSegmentsMarkdown(params: { segments: TranscriptSegment[]; fileLabel?: string }): string {
  const lines: string[] = [];
  lines.push("#### Расшифровка");
  lines.push("");
  for (const seg of params.segments || []) {
    const start = typeof seg.startSec === "number" ? seg.startSec : 0;
    const end = typeof seg.endSec === "number" ? seg.endSec : start;
    const text = String(seg.text ?? "").trim();
    if (!text) continue;
    const timeStr = formatHhMmSsMs(start);
    const endStr = formatHhMmSsMs(end);
    const speakerPart = typeof seg.speaker === "string" && seg.speaker ? ` [[${seg.speaker}]]` : "";
    lines.push(`- **${timeStr}**${speakerPart}  ${text}`);
    const personIdVal = typeof seg.personId === "string" && seg.personId ? `"${seg.personId}"` : "~";
    const voiceprintVal = typeof seg.voiceprint === "string" && seg.voiceprint ? `"${seg.voiceprint}"` : "~";
    lines.push(`<!--`);
    lines.push(`start: "${timeStr}"`);
    lines.push(`end: "${endStr}"`);
    lines.push(`person_id: ${personIdVal}`);
    lines.push(`voiceprint: ${voiceprintVal}`);
    lines.push(`-->`);
  }
  if (lines.length === 2) {
    lines.push("- (пусто)");
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Форматирует сегменты в расширенном формате с метаданными.
 * Формат: `- \`00:00\` [[Person Name]]: Text
 * {"start":"00:00:00,000", "end":"00:00:06,000", "person_id": "...", "voiceprint": "", "emotional": [...]}`
 * 
 * Метаданные скрыты в HTML-комментариях для Obsidian.
 */
export function formatSegmentsMarkdownExtended(params: {
  segments: TranscriptSegment[];
  getPersonName?: (personId: string) => string | null; // Функция для получения имени человека по ID
}): string {
  const lines: string[] = [];
  
  for (const seg of params.segments || []) {
    const start = typeof seg.startSec === "number" ? seg.startSec : 0;
    const end = typeof seg.endSec === "number" ? seg.endSec : start;
    const text = String(seg.text ?? "").trim();
    if (!text) continue;
    
    // Форматируем время в формате MM:SS
    const timeStr = formatTimeShort(start);
    
    // Получаем имя человека
    let personLink = "";
    if (seg.personId && params.getPersonName) {
      const personName = params.getPersonName(seg.personId);
      if (personName) {
        personLink = `[[${personName}]]`;
      }
    }
    
    // Формируем строку реплики
    const personPart = personLink ? `${personLink}: ` : "";
    const line = `- \`${timeStr}\` ${personPart}${text}`;
    lines.push(line);
    
    // Добавляем метаданные в HTML-комментарий (скрыто в Obsidian)
    const meta: Record<string, unknown> = {
      start: formatSrtTime(start),
      end: formatSrtTime(end),
    };
    if (seg.personId) meta.person_id = seg.personId;
    if (seg.voiceprint) meta.voiceprint = seg.voiceprint;
    if (seg.emotions && seg.emotions.length > 0) meta.emotional = seg.emotions;
    if (seg.speaker) meta.speaker = seg.speaker;
    
    const metaJson = JSON.stringify(meta);
    lines.push(`  <!-- ${metaJson} -->`);
  }
  
  if (lines.length === 0) {
    lines.push("- (пусто)");
  }
  
  return lines.join("\n");
}

/**
 * Форматирует время в коротком формате MM:SS
 */
function formatTimeShort(totalSeconds: number): string {
  const s = Math.floor(totalSeconds);
  const m = Math.floor(s / 60);
  const mm = m % 60;
  const ss = s % 60;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${pad2(mm)}:${pad2(ss)}`;
}
