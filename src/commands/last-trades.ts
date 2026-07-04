/**
 * Команда last-trades: лента обезличенных сделок рынка по инструменту.
 *
 * Экспорты:
 * - LastTradesApi — контракт клиента (рыночный резолв + getLastTrades);
 * - LastTradeView / LastTradesView — представление;
 * - fetchLastTrades(api, params) — сделки за последние N часов;
 * - renderLastTrades(view) — таблица ленты.
 *
 * Помогает оценить, торгуется ли бумага прямо сейчас (особенно тонкие
 * облигации). Цена — в котировке инструмента: для облигаций/фьючерсов в
 * пунктах (метка «пт»), иначе в валюте.
 */
import { quotationToNumberOrNull } from '../api/money.js';
import type { GetLastTradesResponse } from '../api/types-market.js';
import { MS_PER_HOUR } from '../config/config.js';
import { formatMoscowDateTime } from '../format/datetime.js';
import { renderTable } from '../format/table.js';
import { formatInstrumentPrice, priceUnitFor, type PriceUnit } from '../format/units.js';
import { DASH } from '../format/values.js';
import { resolveMarketInstrument, type MarketInstrumentApi } from './resolve-instrument.js';

export interface LastTradesApi extends MarketInstrumentApi {
  getLastTrades(instrumentId: string, from: string, to: string): Promise<GetLastTradesResponse>;
}

// Направление обезличенной сделки (enum TRADE_DIRECTION_*) → русский ярлык.
const TRADE_DIRECTION_LABELS: Record<string, string> = {
  TRADE_DIRECTION_BUY: 'покупка',
  TRADE_DIRECTION_SELL: 'продажа',
};

export interface LastTradeView {
  time: string | null; // UTC-строка из API (в рендере — в МСК)
  direction: string | null; // русский ярлык
  price: number | null;
  quantity: number | null; // лоты
}

export interface LastTradesView {
  ticker: string;
  name: string;
  priceUnit: PriceUnit; // единица цены: 'point' (облигации/фьючерсы) | 'currency'
  currency: string | null;
  trades: LastTradeView[];
}

export async function fetchLastTrades(
  api: LastTradesApi,
  params: { query: string; hours: number; now: Date },
): Promise<LastTradesView> {
  const instrument = await resolveMarketInstrument(api, params.query);
  // Период: последние `hours` часов (from/to обязательны по контракту метода).
  const from = new Date(params.now.getTime() - params.hours * MS_PER_HOUR).toISOString();
  const to = params.now.toISOString();
  const resp = await api.getLastTrades(instrument.uid, from, to);
  // Пустая лента — это валидные данные («сделок не было»), не ошибка: рендер
  // покажет соответствующее сообщение.
  const trades = resp.trades ?? [];
  return {
    ticker: instrument.ticker,
    name: instrument.name,
    // instrumentType у индикативов может быть null — тогда трактуем как валюту.
    priceUnit: instrument.instrumentType ? priceUnitFor(instrument.instrumentType) : 'currency',
    currency: instrument.currency,
    trades: trades.map((t) => ({
      time: t.time ?? null,
      direction: t.direction ? (TRADE_DIRECTION_LABELS[t.direction] ?? t.direction) : null,
      price: quotationToNumberOrNull(t.price),
      quantity: t.quantity ? Number(t.quantity) : null,
    })),
  };
}

export function renderLastTrades(view: LastTradesView): string {
  if (view.trades.length === 0) {
    return `${view.name} (${view.ticker}): за выбранный период обезличенных сделок нет.`;
  }
  const table = renderTable(
    ['Время (МСК)', 'Направление', 'Цена', 'Лоты'],
    view.trades.map((t) => [
      t.time ? formatMoscowDateTime(t.time) : DASH,
      t.direction ?? DASH,
      t.price !== null
        ? formatInstrumentPrice(t.price, { unit: view.priceUnit, nominalRub: null, currency: view.currency })
        : DASH,
      t.quantity !== null ? String(t.quantity) : DASH,
    ]),
  );
  return `${view.name} (${view.ticker}) — обезличенные сделки:\n${table}`;
}
