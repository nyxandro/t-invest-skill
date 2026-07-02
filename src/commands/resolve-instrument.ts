/**
 * Общий резолвер инструмента для аналитических команд (bond, dividends,
 * fundamentals, forecast): запрос пользователя → один конкретный инструмент.
 *
 * Экспорты:
 * - InstrumentSearchApi — контракт клиента (только findInstrument);
 * - resolveInstrument(api, query, options) — точное совпадение по тикеру
 *   или ISIN с приоритетом основной торговой сессии МосБиржи.
 *
 * Семантика повторяет quote: работаем только по точному тикеру/ISIN,
 * ничего не угадываем по подстроке (no-fallbacks) — для нечёткого поиска
 * есть команда search.
 */
import { AppError } from '../api/errors.js';
import type { FindInstrumentResponse, InstrumentShort } from '../api/types.js';

export interface InstrumentSearchApi {
  findInstrument(query: string): Promise<FindInstrumentResponse>;
}

export interface ResolveInstrumentOptions {
  // Если задан — инструмент обязан быть этого типа (bond, share, etf...),
  // иначе команда для него не имеет смысла и падаем с понятной ошибкой.
  instrumentType?: string;
}

// Основные («канонические») режимы торгов МосБиржи по типам инструментов.
// Один выпуск встречается в выдаче несколько раз с разными class_code
// (вечерняя сессия, внебиржа и т.п.) — метрики считаем по основной сессии.
const PRIMARY_BOARD_PRIORITY = ['TQBR', 'TQCB', 'TQOB', 'TQTF'];

export async function resolveInstrument(
  api: InstrumentSearchApi,
  query: string,
  options: ResolveInstrumentOptions = {},
): Promise<InstrumentShort> {
  const { instruments } = await api.findInstrument(query);

  // Точное совпадение тикера или ISIN без учёта регистра.
  const normalized = query.trim().toUpperCase();
  const exact = instruments.filter(
    (i) => i.ticker.toUpperCase() === normalized || (i.isin ?? '').toUpperCase() === normalized,
  );
  if (exact.length === 0) {
    throw new AppError({
      code: 'APP_TINVEST_INSTRUMENT_NOT_FOUND',
      userMessage: `Инструмент «${query}» не найден по точному тикеру или ISIN. Найдите точный идентификатор через: tinvest search "${query}".`,
    });
  }

  // Фильтр по типу: команда bond для акции бессмысленна — говорим об этом явно.
  const typed = options.instrumentType
    ? exact.filter((i) => i.instrumentType === options.instrumentType)
    : exact;
  if (typed.length === 0) {
    const foundTypes = [...new Set(exact.map((i) => i.instrumentType))].join(', ');
    throw new AppError({
      code: 'APP_TINVEST_WRONG_INSTRUMENT_TYPE',
      userMessage:
        `«${query}» найден, но это не подходящий тип инструмента для этой команды ` +
        `(требуется ${options.instrumentType}, найдено: ${foundTypes}).`,
    });
  }

  // Приоритет основной сессии; если её нет в выдаче — берём первый вариант:
  // это один и тот же выпуск, отличается только режим торгов.
  for (const board of PRIMARY_BOARD_PRIORITY) {
    const match = typed.find((i) => i.classCode === board);
    if (match) {
      return match;
    }
  }
  return typed[0]!;
}
