/**
 * Policy: человекочитаемые имена протоколов.
 */
export function formatRuDayMonth(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "long" });
}

export function protocolBaseNameFromEvent(params: { summary: string; start: Date }): string {
  return `${params.summary} ${formatRuDayMonth(params.start)}`;
}

export function emptyProtocolBaseName(now: Date): string {
  return `Протокол ${formatRuDayMonth(now)}`;
}

