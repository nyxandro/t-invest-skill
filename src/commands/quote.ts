/**
 * Команда quote: последняя цена инструмента по точному тикеру.
 *
 * Экспорты:
 * - MarketApi — контракт клиента для команды;
 * - QuoteView — представление котировки;
 * - getQuotes(api, tickerQuery) — поиск по точному тикеру + последние цены;
 * - renderQuotes(views) — таблица для вывода.
 *
 * Семантика: quote работает только по точному тикеру (SBER, GAZP).
 * Для поиска по названию есть отдельная команда search — здесь ничего
 * не угадываем (no-fallbacks).
 */
import { AppError } from '../api/errors.js';
import { formatAmount, quotationToNumber } from '../api/money.js';
import type { FindInstrumentResponse, GetLastPricesResponse } from '../api/types.js';
import { renderTable } from '../format/table.js';

export interface MarketApi {
  findInstrument(query: string): Promise<FindInstrumentResponse>;
  getLastPrices(instrumentIds: string[]): Promise<GetLastPricesResponse>;
}

export interface QuoteView {
  ticker: string;
  name: string;
  classCode: string;
  instrumentType: string;
  uid: string;
  figi: string;
  currency: string | null;
  lot: number | null;
  price: number;
  time: string | null;
}

export async function getQuotes(api: MarketApi, tickerQuery: string): Promise<QuoteView[]> {
  const { instruments } = await api.findInstrument(tickerQuery);

  // Точное совпадение тикера без учёта регистра; допускаем несколько
  // совпадений (один тикер на разных площадках) — покажем все.
  const normalized = tickerQuery.trim().toUpperCase();
  const exact = instruments.filter((i) => i.ticker.toUpperCase() === normalized);
  if (exact.length === 0) {
    throw new AppError({
      code: 'APP_TINVEST_INSTRUMENT_NOT_FOUND',
      userMessage: `Инструмент с тикером «${tickerQuery}» не найден. Попробуйте поиск по названию: tinvest search "${tickerQuery}".`,
    });
  }

  const { lastPrices } = await api.getLastPrices(exact.map((i) => i.uid));
  const priceByUid = new Map(lastPrices.map((p) => [p.instrumentUid, p]));

  // Инструменты без котировки пропускаем; если цены нет ни у одного —
  // это явная ошибка, а не пустой «успешный» ответ. ВАЖНО: когда торги
  // не идут, запись в lastPrices приходит вовсе БЕЗ поля price (protobuf
  // JSON опускает незаполненные поля) — такая запись равна отсутствию цены.
  const views = exact.flatMap((i): QuoteView[] => {
    const lastPrice = priceByUid.get(i.uid);
    if (!lastPrice?.price) {
      return [];
    }
    return [
      {
        ticker: i.ticker,
        name: i.name,
        classCode: i.classCode,
        instrumentType: i.instrumentType,
        uid: i.uid,
        figi: i.figi,
        currency: i.currency ?? null,
        lot: i.lot ?? null,
        price: quotationToNumber(lastPrice.price),
        time: lastPrice.time ?? null,
      },
    ];
  });

  if (views.length === 0) {
    throw new AppError({
      code: 'APP_TINVEST_PRICE_UNAVAILABLE',
      userMessage: `Не удалось получить котировку для «${tickerQuery}». Возможно, торги по инструменту сейчас не идут.`,
    });
  }
  return views;
}

export function renderQuotes(views: QuoteView[]): string {
  const dash = '—';
  return renderTable(
    ['Тикер', 'Название', 'Цена', 'Валюта', 'Лот', 'Класс', 'Время'],
    views.map((v) => [
      v.ticker,
      v.name,
      formatAmount(v.price),
      v.currency ? v.currency.toUpperCase() : dash,
      v.lot !== null ? String(v.lot) : dash,
      v.classCode,
      v.time !== null ? v.time.slice(0, 16).replace('T', ' ') : dash,
    ]),
  );
}
