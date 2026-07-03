/**
 * Общий резолвер инструмента для аналитических команд (bond, dividends,
 * fundamentals, forecast): запрос пользователя → один конкретный инструмент.
 *
 * Экспорты:
 * - InstrumentSearchApi — контракт клиента (только findInstrument);
 * - resolveInstrument(api, query, options) — точное совпадение по тикеру
 *   или ISIN с приоритетом основной торговой сессии МосБиржи;
 * - resolveLabelByFigi(api, figi) — тикер/имя по FIGI для ответов, где API
 *   не отдаёт ticker (replace, stop-list); null, если не найден;
 * - MarketInstrumentApi — контракт для рыночных команд (findInstrument +
 *   getIndicatives);
 * - ResolvedMarketInstrument — унифицированный результат рыночного резолва
 *   (uid + метаданные для карточек, различает инструмент и индикатив);
 * - resolveMarketInstrument(api, query, options) — рыночный резолвер: обычный
 *   инструмент по тикеру/ISIN, а для индексов (IMOEX/RTSI) — fallback на
 *   индикативные инструменты. Общий для history/quote/tech/orderbook.
 *
 * Семантика повторяет quote: работаем только по точному тикеру/ISIN,
 * ничего не угадываем по подстроке (no-fallbacks) — для нечёткого поиска
 * есть команда search.
 */
import { AppError } from '../api/errors.js';
import type { IndicativesResponse } from '../api/types-catalog.js';
import type { FindInstrumentResponse, InstrumentShort } from '../api/types.js';

export interface InstrumentSearchApi {
  findInstrument(query: string): Promise<FindInstrumentResponse>;
}

export interface ResolveInstrumentOptions {
  // Если задан — инструмент обязан быть этого типа (bond, share, etf...),
  // иначе команда для него не имеет смысла и падаем с понятной ошибкой.
  instrumentType?: string;
  // Если true — при совпадении тикера/ISIN у НЕСКОЛЬКИХ РАЗНЫХ выпусков
  // (разные эмитенты/площадки) не выбираем «первый» молча, а падаем с ошибкой
  // неоднозначности. Обязателен для торгового пути: иначе можно купить не то.
  requireUnambiguous?: boolean;
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

  // Проверка однозначности (для торгового пути): считаем РАЗНЫМИ инструментами
  // те, что отличаются по ISIN (а при его отсутствии — по uid). Несколько
  // class_code одного выпуска (сессии/площадки одной бумаги) — это НЕ
  // неоднозначность, а вот совпадение тикера у разных эмитентов — да.
  if (options.requireUnambiguous) {
    const distinct = new Map(typed.map((i) => [i.isin || i.uid, i]));
    if (distinct.size > 1) {
      const variants = [...distinct.values()]
        .map((i) => `${i.ticker}/${i.classCode}/${i.isin ?? '—'}`)
        .join('; ');
      throw new AppError({
        code: 'APP_TINVEST_INSTRUMENT_AMBIGUOUS',
        userMessage:
          `«${query}» соответствует нескольким разным инструментам (${variants}). ` +
          'Уточните запрос по ISIN, чтобы однозначно выбрать нужный выпуск.',
      });
    }
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

// Резолв тикера/имени по FIGI. Ответы ReplaceOrder и GetStopOrders не содержат
// ticker (только figi/instrumentUid), поэтому для читаемого вывода бумагу
// приходится доставать отдельно; FindInstrument принимает figi как запрос.
// null — не нашли (тогда UI оставляет исходный идентификатор): это презентация,
// а не обязательные данные, поэтому деградация допустима (см. вызовы).
export async function resolveLabelByFigi(
  api: InstrumentSearchApi,
  figi: string,
): Promise<{ ticker: string; name: string } | null> {
  if (!figi) {
    return null;
  }
  const { instruments } = await api.findInstrument(figi);
  const match = instruments.find((i) => i.figi === figi);
  return match ? { ticker: match.ticker, name: match.name } : null;
}

// Контракт для рыночных команд (history/quote/tech/orderbook): обычный поиск
// плюс индикативные инструменты. Индексы (IMOEX/RTSI) не возвращаются методом
// FindInstrument — их отдаёт отдельный метод Indicatives, поэтому рыночный
// резолвер обязан уметь обращаться к обоим источникам.
export interface MarketInstrumentApi extends InstrumentSearchApi {
  getIndicatives(): Promise<IndicativesResponse>;
}

// Унифицированный результат рыночного резолва. uid используется для запросов
// котировок/свечей/стакана; kind различает торгуемый инструмент и индикатив
// (индекс). Презентационные поля (figi/classCode/...) нужны карточке quote —
// у индексов часть из них отсутствует, тогда null (no-fallbacks: не 0/пусто).
export interface ResolvedMarketInstrument {
  uid: string;
  ticker: string;
  name: string;
  kind: 'instrument' | 'indicative';
  figi: string | null;
  classCode: string | null;
  instrumentType: string | null;
  currency: string | null;
  lot: number | null;
}

export async function resolveMarketInstrument(
  api: MarketInstrumentApi,
  query: string,
  options: ResolveInstrumentOptions = {},
): Promise<ResolvedMarketInstrument> {
  // Приоритет — обычный резолв по точному тикеру/ISIN (акции, облигации, фонды).
  try {
    const instrument = await resolveInstrument(api, query, options);
    return {
      uid: instrument.uid,
      ticker: instrument.ticker,
      name: instrument.name,
      kind: 'instrument',
      figi: instrument.figi,
      classCode: instrument.classCode,
      instrumentType: instrument.instrumentType,
      currency: instrument.currency ?? null,
      lot: instrument.lot ?? null,
    };
  } catch (err) {
    // Fallback на индикативы только для «не найден»: у индексов нет записи в
    // FindInstrument (метод вернул пустой список), но есть в Indicatives. Любую
    // другую ошибку (неверный тип, неоднозначность) пробрасываем как есть.
    if (!(err instanceof AppError) || err.code !== 'APP_TINVEST_INSTRUMENT_NOT_FOUND') {
      throw err;
    }
    const { instruments } = await api.getIndicatives();
    const normalized = query.trim().toUpperCase();
    const match = instruments.find((i) => i.ticker.toUpperCase() === normalized);
    if (!match) {
      throw err; // исходная ошибка понятнее: «не найден точный тикер/ISIN»
    }
    return {
      uid: match.uid,
      ticker: match.ticker,
      name: match.name,
      kind: 'indicative',
      figi: match.figi ?? null,
      classCode: match.classCode ?? null,
      instrumentType: match.instrumentKind ?? null,
      currency: match.currency ?? null,
      lot: null, // у индикативов лота нет — торговля недоступна
    };
  }
}
