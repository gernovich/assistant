/** Дефолтные названия цветов событий Google Calendar (event colors). */
export const DEFAULT_GOOGLE_EVENT_COLOR_LABELS: Record<string, string> = {
  "1": "Лаванда",
  "2": "Шалфей",
  "3": "Виноград",
  "4": "Фламинго",
  "5": "Банан",
  "6": "Мандарин",
  "7": "Павлиний",
  "8": "Графит",
  "9": "Черника",
  "10": "Базилик",
  "11": "Томат",
};

export function mergeGoogleEventColorLabels(custom?: Record<string, string>): Record<string, string> {
  return { ...DEFAULT_GOOGLE_EVENT_COLOR_LABELS, ...(custom ?? {}) };
}

