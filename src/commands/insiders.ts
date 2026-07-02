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
import { quotationToNumber, formatAmount } from '../api/money.js';
import type { GetInsiderDealsResponse, InsiderDeal } from '../api/types-info.js';
import { renderTable } from '../format/table.js';
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

function toDirection(raw: string | undefined): 'buy' | 'sell' | null {
  if (raw === 'TRADE_DIRECTION_BUY') {
    return 'buy';
  }
  if (raw === 'TRADE_DIRECTION_SELL') {
    return 'sell';
  }
  return null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildInsidersView(ticker: string, name: string, deals: InsiderDeal[]): InsidersView {
  const views = deals.map((deal): InsiderDealView => {
    const price = deal.price ? quotationToNumber(deal.price) : null;
    const quantity = deal.quantity ? Number(deal.quantity) : null;
    return {
      date: deal.date?.slice(0, 10) ?? null,
      direction: toDirection(deal.direction),
      investorName: deal.investorName ?? null,
      investorPosition: deal.investorPosition ?? null,
      quantity,
      price,
      amount: price !== null && quantity !== null ? round2(price * quantity) : null,
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
  const dash = '—';
  const header = `${view.ticker} — ${view.name}: сделки инсайдеров (покупок: ${view.buyCount}, продаж: ${view.sellCount})`;
  if (view.deals.length === 0) {
    return `${header}\nРаскрытых сделок инсайдеров нет.`;
  }
  const table = renderTable(
    ['Дата', 'Тип', 'Кто', 'Кол-во', 'Цена', 'Сумма'],
    view.deals.map((d) => [
      d.date ?? dash,
      d.direction === 'buy' ? 'покупка' : d.direction === 'sell' ? 'продажа' : dash,
      `${d.investorName ?? dash}${d.investorPosition ? ` (${d.investorPosition})` : ''}`,
      d.quantity !== null ? formatAmount(d.quantity, 0) : dash,
      d.price !== null ? formatAmount(d.price) : dash,
      d.amount !== null ? formatAmount(d.amount, 0) : dash,
    ]),
  );
  return `${header}\n${table}`;
}
