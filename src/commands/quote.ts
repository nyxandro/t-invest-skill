/**
 * Команда quote: последняя цена инструмента по тикеру или ISIN (и индексам).
 *
 * Экспорты:
 * - MarketApi — контракт клиента для команды;
 * - QuoteView — представление котировки;
 * - getQuotes(api, query) — резолв одного инструмента + последняя цена;
 * - renderQuotes(views) — таблица для вывода.
 *
 * Семантика: quote работает по точному тикеру ИЛИ ISIN (а для индексов —
 * IMOEX/RTSI — через индикативы). Разрешение имени делегировано общему
 * resolveMarketInstrument, чтобы не дублировать матчинг (K26/K44). Для поиска
 * по названию есть отдельная команда search — здесь ничего не угадываем.
 */
import { formatAmount, quotationToNumberOrNull } from '../api/money.js';
import type { GetLastPricesResponse } from '../api/types.js';
import { formatMoscowDateTime } from '../format/datetime.js';
import { renderTable } from '../format/table.js';
import { DASH } from '../format/values.js';
import { resolveMarketInstrument, type MarketInstrumentApi } from './resolve-instrument.js';

export interface MarketApi extends MarketInstrumentApi {
  getLastPrices(instrumentIds: string[]): Promise<GetLastPricesResponse>;
}

export interface QuoteView {
  ticker: string;
  name: string;
  classCode: string | null;
  instrumentType: string | null;
  uid: string;
  figi: string | null;
  currency: string | null;
  lot: number | null;
  price: number | null; // null — торгов нет / цена недоступна (НЕ 0)
  time: string | null;
}

export async function getQuotes(api: MarketApi, query: string): Promise<QuoteView[]> {
  // Единый рыночный резолвер: точный тикер/ISIN, а для индексов (IMOEX/RTSI)
  // — fallback на индикативы. Так quote работает и по ISIN, и по индексам,
  // не переизобретая матчинг только по тикеру (это и был баг K26).
  const instrument = await resolveMarketInstrument(api, query);

  // Последняя цена по одному инструменту. Может отсутствовать (торги не идут):
  // quotationToNumberOrNull вернёт null, а НЕ 0 — важно не показать «нулевую
  // цену» там, где цены попросту нет (ловушка protobuf-JSON: поле опускается).
  const { lastPrices } = await api.getLastPrices([instrument.uid]);
  const lastPrice = lastPrices.find((p) => p.instrumentUid === instrument.uid);
  const price = quotationToNumberOrNull(lastPrice?.price);

  // Всегда возвращаем строку представления: даже без цены пользователю полезно
  // видеть, что инструмент найден, а цена — прочерк (нет торгов), не ошибка.
  // Возвращаем массив (один элемент) — контракт renderQuotes/CLI не меняем.
  return [
    {
      ticker: instrument.ticker,
      name: instrument.name,
      classCode: instrument.classCode,
      instrumentType: instrument.instrumentType,
      uid: instrument.uid,
      figi: instrument.figi,
      currency: instrument.currency,
      lot: instrument.lot,
      price,
      time: lastPrice?.time ?? null,
    },
  ];
}

export function renderQuotes(views: QuoteView[]): string {
  return renderTable(
    ['Тикер', 'Название', 'Цена', 'Валюта', 'Лот', 'Класс', 'Время'],
    views.map((v) => [
      v.ticker,
      v.name,
      v.price !== null ? formatAmount(v.price) : DASH,
      v.currency ? v.currency.toUpperCase() : DASH,
      v.lot !== null ? String(v.lot) : DASH,
      v.classCode ?? DASH,
      v.time !== null ? formatMoscowDateTime(v.time) : DASH,
    ]),
  );
}
