/**
 * Единый набор кодов ошибок приложения (AppErrorDto.code).
 *
 * Зачем:
 * - не плодить “магические строки” по проекту;
 * - упростить агрегацию/фильтрацию/метрики ошибок;
 * - иметь стабильные коды для тестов и UI (notice/log).
 *
 * Принцип: добавляем коды по мере распространения Result-граней.
 */
export const APP_ERROR = {
  VALIDATION: "E_VALIDATION",
  NOT_FOUND: "E_NOT_FOUND",
  READ_ONLY: "E_READ_ONLY",
  TIMEOUT: "E_TIMEOUT",
  INTERNAL: "E_INTERNAL",

  SETTINGS: "E_SETTINGS",

  NETWORK: "E_NETWORK",
  ICS_FETCH: "E_ICS_FETCH",
  FS_IO: "E_FS_IO",

  OUTBOX: "E_OUTBOX",
  VAULT_IO: "E_VAULT_IO",

  CALDAV_AUTH: "E_CALDAV_AUTH",
  CALDAV_WRITEBACK: "E_CALDAV_WRITEBACK",
  CALDAV_DISCOVERY: "E_CALDAV_DISCOVERY",

  RECORDING_BACKEND: "E_RECORDING_BACKEND",
  ELECTRON_UNAVAILABLE: "E_ELECTRON_UNAVAILABLE",
} as const;

export type AppErrorCode = (typeof APP_ERROR)[keyof typeof APP_ERROR];
