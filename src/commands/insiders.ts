/**
 * Команда insiders: сделки инсайдеров по бумаге (GetInsiderDeals) —
 * кто из связанных с эмитентом лиц покупал/продавал и на сколько.
 *
 * Экспорты:
 * - InsidersApi — контракт клиента;
 * - InsiderDealView — представление сделки;
 * - buildInsidersView(ticker, name, deals) — чистая сборка;
 * - fetchInsiders(api, query, limit) — резолв + загрузка + сборка;
 * - renderInsiders(view) — человекочитаемый вывод.
 */
import { quotationToNumberOrNull, round } from '../api/money.js';
import type { GetInsiderDealsResponse, InsiderDeal } from '../api/types-info.js';
import { directionLabel } from '../format/direction.js';
import { renderTable } from '../format/table.js';
import { DASH, moneyOrDash } from '../format/values.js';
import { resolveInstrument, type InstrumentSearchApi } from './resolve-instrument.js';

export interface InsidersApi extends InstrumentSearchApi {
  getInsiderDeals(instrumentId: string, limit: number): Promise<GetInsiderDealsResponse>;
}

export interface InsiderDealView {
  date: string | null;
  direction: 'buy' | 'sell' | null;
  investorName: string | null;
  investorPosition: string | null;
  quantity: number | null;
  price: number | null;
  amount: number | null; // price × quantity
  percentage: number | null; // доля сделки от капитала, %
  disclosureDate: string | null;
}

export interface InsidersView {
  ticker: string;
  name: string;
  deals: InsiderDealView[];
  buyCount: number;
  sellCount: number;
}

// Направление сделки инсайдера — собственный enum TRADE_DIRECTION_* (не order/stop),
// поэтому маппинг локальный; на неизвестное значение честно null.
function toDirection(raw: string | undefined): 'buy' | 'sell' | null {
  if (raw === 'TRADE_DIRECTION_BUY') {
    return 'buy';
  }
  if (raw === 'TRADE_DIRECTION_SELL') {
    return 'sell';
  }
  return null;
}

export function buildInsidersView(ticker: string, name: string, deals: InsiderDeal[]): InsidersView {
  const views = deals.map((deal): InsiderDealView => {
    // Опущенный protobuf-JSON price → null (в отличие от настоящего 0).
    const price = quotationToNumberOrNull(deal.price);
    const quantity = deal.quantity ? Number(deal.quantity) : null;
    return {
      date: deal.date?.slice(0, 10) ?? null,
      direction: toDirection(deal.direction),
      investorName: deal.investorName ?? null,
      investorPosition: deal.investorPosition ?? null,
      quantity,
      price,
      amount: price !== null && quantity !== null ? round(price * quantity) : null,
      percentage: deal.percentage ?? null,
      disclosureDate: deal.disclosureDate?.slice(0, 10) ?? null,
    };
  });
  return {
    ticker,
    name,
    deals: views,
    buyCount: views.filter((d) => d.direction === 'buy').length,
    sellCount: views.filter((d) => d.direction === 'sell').length,
  };
}

export async function fetchInsiders(
  api: InsidersApi,
  query: string,
  limit: number,
): Promise<InsidersView> {
  const instrument = await resolveInstrument(api, query);
  const resp = await api.getInsiderDeals(instrument.uid, limit);
  return buildInsidersView(instrument.ticker, instrument.name, resp.insiderDeals ?? []);
}

export function renderInsiders(view: InsidersView): string {
  const header = `${view.ticker} — ${view.name}: сделки инсайдеров (покупок: ${view.buyCount}, продаж: ${view.sellCount})`;
  if (view.deals.length === 0) {
    return `${header}\nРаскрытых сделок инсайдеров нет.`;
  }
  const table = renderTable(
    ['Дата', 'Тип', 'Кто', 'Кол-во', 'Цена', 'Сумма'],
    view.deals.map((d) => [
      d.date ?? DASH,
      directionLabel(d.direction),
      `${d.investorName ?? DASH}${d.investorPosition ? ` (${d.investorPosition})` : ''}`,
      moneyOrDash(d.quantity, 0),
      moneyOrDash(d.price),
      moneyOrDash(d.amount, 0),
    ]),
  );
  return `${header}\n${table}`;
}
