/**
 * Прикладная ошибка со стабильным кодом и русскоязычным сообщением.
 *
 * Экспорты:
 * - AppError — класс ошибки: code (стабильный код для поддержки/логов),
 *   userMessage (понятное человеку сообщение на русском), details
 *   (технические подробности для логов), cause (исходная ошибка).
 */

export class AppError extends Error {
  readonly code: string;
  readonly userMessage: string;
  readonly details?: unknown;

  constructor(params: { code: string; userMessage: string; details?: unknown; cause?: unknown }) {
    // В message кладём код и текст — так ошибка читаема и в сырых логах.
    super(`${params.code}: ${params.userMessage}`, { cause: params.cause });
    this.name = 'AppError';
    this.code = params.code;
    this.userMessage = params.userMessage;
    this.details = params.details;
  }
}
