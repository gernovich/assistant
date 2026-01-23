import type { AppErrorDto, ErrorCode } from "./result";

/**
 * Typed error для тех мест, где мы пока используем `throw`, но хотим переносить код ошибки/контекст.
 *
 * Важно: `message` в AppErrorDto безопасно показывать пользователю (UI).
 */
export class AppError extends Error {
  readonly dto: AppErrorDto;

  constructor(dto: AppErrorDto) {
    super(dto.message);
    this.name = "AppError";
    this.dto = dto;
  }
}

export function isAppError(e: unknown): e is AppError {
  return typeof e === "object" && e !== null && (e as any).name === "AppError" && typeof (e as any).dto === "object";
}

export function toAppErrorDto(e: unknown, fallback: { code: ErrorCode; message: string; details?: Record<string, unknown> }): AppErrorDto {
  if (isAppError(e)) return e.dto;
  const cause = String((e as unknown) ?? "неизвестная ошибка");
  return { code: fallback.code, message: fallback.message, cause, details: fallback.details };
}
