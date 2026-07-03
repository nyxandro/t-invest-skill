/**
 * Команда orderbook: биржевой стакан — лучшие цены, спред, глубина
 * и дисбаланс заявок (оценка ликвидности перед сделкой).
 *
 * Экспорты:
 * - OrderBookApi — контракт клиента;
 * - OrderBookView — представление стакана;
 * - buildOrderBookView(...) — чистая сборка (тестируется без API);
 * - fetchOrderBook(api, query, depth) — резолв + загрузка + сборка;
 * - renderOrderBook(view) — человекочитаемый вывод.
 */
import { quotationToNumber, formatAmount, round } from '../api/money.js';
import type { GetOrderBookResponse, OrderBookEntry } from '../api/types-market.js';
import { renderTable } from '../format/table.js';
import { DASH } from '../format/values.js';
import { resolveMarketInstrument, type MarketInstrumentApi } from './resolve-instrument.js';

export interface OrderBookApi extends MarketInstrumentApi {
  getOrderBook(instrumentId: string, depth: number): Promise<GetOrderBookResponse>;
}

export interface OrderBookLevelView {
  price: number;
  quantity: number; // лоты
}

export interface OrderBookView {
  ticker: string;
  name: string;
  depth: number;
  bids: OrderBookLevelView[];
  asks: OrderBookLevelView[];
  bestBid: number | null;
  bestAsk: number | null;
  spreadPercent: number | null; // (ask - bid) / mid × 100
  bidVolume: number; // суммарные лоты на покупку в глубине стакана
  askVolume: number;
  lastPrice: number | null;
  limitUp: number | null;
  limitDown: number | null;
}

function toLevels(entries: OrderBookEntry[] | undefined): OrderBookLevelView[] {
  return (entries ?? [])
    .filter((e) => e.price !== undefined && e.quantity !== undefined)
    .map((e) => ({ price: quotationToNumber(e.price!), quantity: Number(e.quantity) }));
}

export function buildOrderBookView(params: {
  ticker: string;
  name: string;
  resp: GetOrderBookResponse;
}): OrderBookView {
  const bids = toLevels(params.resp.bids);
  const asks = toLevels(params.resp.asks);
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  // Спред к середине: стандартная мера издержек немедленной сделки.
  const spreadPercent =
    bestBid !== null && bestAsk !== null && bestBid + bestAsk > 0
      ? round(((bestAsk - bestBid) / ((bestAsk + bestBid) / 2)) * 100, 4)
      : null;
  return {
    ticker: params.ticker,
    name: params.name,
    depth: params.resp.depth ?? bids.length,
    bids,
    asks,
    bestBid,
    bestAsk,
    spreadPercent,
    bidVolume: bids.reduce((s, l) => s + l.quantity, 0),
    askVolume: asks.reduce((s, l) => s + l.quantity, 0),
    lastPrice: params.resp.lastPrice ? quotationToNumber(params.resp.lastPrice) : null,
    limitUp: params.resp.limitUp ? quotationToNumber(params.resp.limitUp) : null,
    limitDown: params.resp.limitDown ? quotationToNumber(params.resp.limitDown) : null,
  };
}

export async function fetchOrderBook(
  api: OrderBookApi,
  query: string,
  depth: number,
): Promise<OrderBookView> {
  // Общий рыночный резолвер: тикер/ISIN, а для индексов — fallback на
  // индикативы (K44). У индексов стакана нет — API вернёт пустой, покажем это.
  const instrument = await resolveMarketInstrument(api, query);
  const resp = await api.getOrderBook(instrument.uid, depth);
  return buildOrderBookView({ ticker: instrument.ticker, name: instrument.name, resp });
}

export function renderOrderBook(view: OrderBookView): string {
  const lines = [
    `${view.ticker} — ${view.name} (стакан, глубина ${view.depth})`,
    `Лучшая покупка/продажа: ${view.bestBid !== null ? formatAmount(view.bestBid) : DASH} / ${view.bestAsk !== null ? formatAmount(view.bestAsk) : DASH}` +
      (view.spreadPercent !== null ? ` | спред ${formatAmount(view.spreadPercent, 3)} %` : ''),
    `Объём в стакане (лоты): покупка ${formatAmount(view.bidVolume, 0)} | продажа ${formatAmount(view.askVolume, 0)}`,
    '',
  ];
  if (view.bids.length === 0 && view.asks.length === 0) {
    lines.push('Стакан пуст — торги по инструменту сейчас не идут.');
    return lines.join('\n');
  }
  const rows = Math.max(view.bids.length, view.asks.length);
  const table = renderTable(
    ['Покупка (лоты)', 'Цена bid', 'Цена ask', 'Продажа (лоты)'],
    Array.from({ length: rows }, (_, i) => [
      view.bids[i] ? formatAmount(view.bids[i]!.quantity, 0) : '',
      view.bids[i] ? formatAmount(view.bids[i]!.price) : '',
      view.asks[i] ? formatAmount(view.asks[i]!.price) : '',
      view.asks[i] ? formatAmount(view.asks[i]!.quantity, 0) : '',
    ]),
  );
  lines.push(table);
  return lines.join('\n');
}
