/**
 * Утилиты для “машинных” секций в markdown заметках.
 *
 * Зачем:
 * - заметки встреч/протоколов содержат блоки, которые плагин обновляет автоматически;
 * - пользователь при этом должен спокойно редактировать свои секции;
 * - при regen шаблона мы сохраняем “хвосты” пользовательских секций и список протоколов.
 *
 * Используем маркеры:
 * - `<!-- ASSISTANT:PROTOCOLS -->` — секция протоколов во встрече
 * - `<!-- ASSISTANT:USER -->` — пользовательская секция во встрече
 * - (legacy) `<!-- ASSISTANT:NOTES -->` — старый маркер пользовательской секции
 */

const USER_MARKER_NEW = "<!-- ASSISTANT:USER -->";
const USER_MARKER_OLD = "<!-- ASSISTANT:NOTES -->";
const PROTOCOLS_MARKER = "<!-- ASSISTANT:PROTOCOLS -->";

/**
 * Смёржить “авто‑генерируемый шаблон” с существующей заметкой, сохранив:
 * - выбранные frontmatter ключи (например пользовательские поля)
 * - список протоколов (под `ASSISTANT:PROTOCOLS`)
 * - хвост пользовательской секции (после `ASSISTANT:USER` / `ASSISTANT:NOTES`)
 */
export function mergePreservingAssistantSections(
  existing: string,
  regenerated: string,
  params?: { keepFrontmatterKeys?: string[] },
): string {
  const keepKeys = params?.keepFrontmatterKeys ?? [];
  const regeneratedWithFm = keepKeys.length ? mergeFrontmatterPreservingKeys(existing, regenerated, keepKeys) : regenerated;

  const userIdxNew = existing.indexOf(USER_MARKER_NEW);
  const userIdxOld = existing.indexOf(USER_MARKER_OLD);
  const userMarker = userIdxNew !== -1 ? USER_MARKER_NEW : USER_MARKER_OLD;
  const userIdx = userIdxNew !== -1 ? userIdxNew : userIdxOld;
  const userTail = userIdx === -1 ? "" : existing.slice(userIdx + userMarker.length).trimStart();

  const protocolsBody = extractProtocolsBody(existing);

  let out = regeneratedWithFm;

  // Вставляем тело секции “Протоколы”
  const regenProtoIdx = out.indexOf(PROTOCOLS_MARKER);
  if (regenProtoIdx !== -1) {
    const insertAt = regenProtoIdx + PROTOCOLS_MARKER.length;
    const after = out.slice(insertAt);
    const nextSectionIdx = after.search(/\n##\s+/);
    const sliceEnd = nextSectionIdx === -1 ? out.length : insertAt + nextSectionIdx;
    const beforePart = out.slice(0, insertAt);
    const afterPart = out.slice(sliceEnd);
    const body = protocolsBody.trim();
    const normalizedBody = body ? "\n" + body + "\n" : "\n- (пока пусто)\n";
    out = beforePart + normalizedBody + afterPart;
  }

  // Вставляем сохранённый “хвост” пользовательской секции
  const regenUserIdx = out.indexOf(USER_MARKER_NEW);
  if (regenUserIdx !== -1) {
    const before = out.slice(0, regenUserIdx + USER_MARKER_NEW.length);
    out = before + "\n" + (userTail ? userTail.trimStart() : "") + "\n";
    if (!out.endsWith("\n")) out += "\n";
  }

  return out;
}

/**
 * Извлечь тело секции протоколов.
 *
 * Семантика:
 * - если есть marker `ASSISTANT:PROTOCOLS` — парсим до следующей секции/пользовательского маркера
 * - иначе пытаемся найти заголовок `## Протоколы` (fallback для старых заметок)
 */
export function extractProtocolsBody(text: string): string {
  const mIdx = text.indexOf(PROTOCOLS_MARKER);
  if (mIdx !== -1) {
    const start = mIdx + PROTOCOLS_MARKER.length;
    const after = text.slice(start);
    const endByUserNew = after.indexOf(USER_MARKER_NEW);
    const endByUserOld = after.indexOf(USER_MARKER_OLD);
    const endByH2 = after.search(/\n##\s+/);
    const ends = [endByUserNew, endByUserOld, endByH2].filter((x) => x !== -1);
    const end = ends.length === 0 ? after.length : Math.min(...ends);
    return after.slice(0, end).trim();
  }

  // Fallback: парсим между заголовком секции и следующим "##"
  const heading = "## Протоколы";
  const hIdx = text.indexOf(heading);
  if (hIdx === -1) return "";
  const afterH = text.slice(hIdx + heading.length);
  const endByNext = afterH.search(/\n##\s+/);
  const body = endByNext === -1 ? afterH : afterH.slice(0, endByNext);
  return body.replace(PROTOCOLS_MARKER, "").replace(USER_MARKER_NEW, "").replace(USER_MARKER_OLD, "").trim();
}

/** Достать targets из wiki-links вида `[[path]]` или `[[path|alias]]`. */
export function extractWikiLinkTargets(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/\[\[([^\]]+)\]\]/);
    if (!m) continue;
    const inside = m[1];
    const target = inside.split("|")[0].trim();
    if (target) out.push(target);
  }
  return out;
}

/**
 * Добавить ссылку на протокол в секцию “Протоколы” (без дублей).
 *
 * Если маркера нет — создаём секцию или вставляем marker после заголовка.
 */
export function upsertProtocolLink(text: string, linkLine: string): string {
  if (text.includes(linkLine)) return text;
  const idx = text.indexOf(PROTOCOLS_MARKER);

  if (idx === -1) {
    // Fallback: дописываем в секцию протоколов (или создаём её)
    const heading = "## Протоколы";
    const hIdx = text.indexOf(heading);
    if (hIdx === -1) return text + `\n\n${heading}\n${PROTOCOLS_MARKER}\n${linkLine}\n`;
    const insertPos = hIdx + heading.length;
    return text.slice(0, insertPos) + `\n${PROTOCOLS_MARKER}\n${linkLine}\n` + text.slice(insertPos);
  }

  const insertAt = idx + PROTOCOLS_MARKER.length;
  const before = text.slice(0, insertAt);
  const after = text.slice(insertAt);

  // Убираем placeholder, если он стоит в начале тела секции
  const cleanedAfter = after.replace(/^\s*\n- \(пока пусто\)\s*\n/, "\n");
  return before + `\n${linkLine}\n` + cleanedAfter;
}

/** В пользовательской секции проставить строку `- Статус: отменена` (без дублей). */
export function upsertCancelledFlagInUserSection(text: string): string {
  const userIdxNew = text.indexOf(USER_MARKER_NEW);
  const userIdxOld = text.indexOf(USER_MARKER_OLD);
  const marker = userIdxNew !== -1 ? USER_MARKER_NEW : USER_MARKER_OLD;
  const idx = userIdxNew !== -1 ? userIdxNew : userIdxOld;
  if (idx === -1) return text;

  const head = text.slice(0, idx + marker.length);
  const tail = text.slice(idx + marker.length);
  const line = "- Статус: отменена";
  if (tail.includes(line)) return text;

  return head + "\n" + line + "\n" + tail.trimStart();
}

function mergeFrontmatterPreservingKeys(existing: string, regenerated: string, keys: string[]): string {
  const ex = extractFrontmatter(existing);
  const re = extractFrontmatter(regenerated);
  if (!ex || !re) return regenerated;

  const exMap = parseFrontmatterLines(ex.lines);
  const reLines = re.lines.slice();

  let changed = false;
  for (const k of keys) {
    const v = exMap[k];
    if (v == null) continue;

    const idx = reLines.findIndex((l) => l.trimStart().startsWith(`${k}:`));
    if (idx !== -1) {
      const curVal = reLines[idx].split(":").slice(1).join(":").trim();
      if (!curVal) {
        reLines[idx] = `${k}: ${v}`;
        changed = true;
      }
      continue;
    }

    const insertAfter = reLines.findIndex((l) => l.trimStart().startsWith("assistant_type:"));
    const insertAt = insertAfter === -1 ? 0 : insertAfter + 1;
    reLines.splice(insertAt, 0, `${k}: ${v}`);
    changed = true;
  }

  if (!changed) return regenerated;
  const merged = ["---", ...reLines, "---", re.body].join("\n");
  return merged.endsWith("\n") ? merged : merged + "\n";
}

function extractFrontmatter(md: string): { lines: string[]; body: string } | null {
  const s = String(md ?? "");
  if (!s.startsWith("---\n")) return null;
  const end = s.indexOf("\n---\n", 4);
  if (end === -1) return null;
  const fm = s.slice(4, end);
  const body = s.slice(end + "\n---\n".length);
  return { lines: fm.split("\n"), body: body.startsWith("\n") ? body.slice(1) : body };
}

function parseFrontmatterLines(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    const m = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim();
    out[key] = value;
  }
  return out;
}
