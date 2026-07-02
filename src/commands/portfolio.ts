/**
 * Команда portfolio: состав портфеля, стоимость и P/L позиций.
 *
 * Экспорты:
 * - PortfolioApi — контракт клиента для команды;
 * - PortfolioPositionView, PortfolioTotals, PortfolioView — представление;
 * - buildPortfolioView(resp, namesByUid?) — конвертация ответа API в представление;
 * - fetchPortfolio(api, explicitAccountId?) — выбор счёта + загрузка +
 *   обогащение позиций полными названиями инструментов + сборка;
 * - renderPortfolio(view) — человекочитаемый вывод (сводка + таблица).
 */
import { formatAmount, formatSigned, moneyToNumber, quotationToNumber } from '../api/money.js';
import type { GetInstrumentByResponse, PortfolioResponse } from '../api/types.js';
import { renderTable, truncate } from '../format/table.js';
import { resolveAccountId, type AccountsApi } from './resolve-account.js';

export interface PortfolioApi extends AccountsApi {
  getPortfolio(accountId: string): Promise<PortfolioResponse>;
  getInstrumentByUid(uid: string): Promise<GetInstrumentByResponse>;
}

export interface PortfolioPositionView {
  ticker: string;
  name: string | null;
  instrumentType: string;
  quantity: number;
  averagePrice: number | null;
  currentPrice: number | null;
  value: number | null;
  pnl: number | null;
  pnlPercent: number | null;
  nkdPerUnit: number | null;
  dailyYield: number | null;
}

export interface PortfolioTotals {
  portfolio: number;
  shares: number;
  bonds: number;
  etf: number;
  currencies: number;
}

export interface PortfolioView {
  accountId: string;
  currency: string;
  totals: PortfolioTotals;
  expectedYieldPercent: number;
  dailyYield: number | null;
  positions: PortfolioPositionView[];
}

// Округление производных величин до копеек — только для представления.
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildPortfolioView(
  resp: PortfolioResponse,
  namesByUid: ReadonlyMap<string, string> = new Map(),
): PortfolioView {
  const positions = resp.positions.map((p): PortfolioPositionView => {
    const quantity = quotationToNumber(p.quantity);
    const averagePrice = p.averagePositionPrice ? moneyToNumber(p.averagePositionPrice) : null;
    const currentPrice = p.currentPrice ? moneyToNumber(p.currentPrice) : null;

    // P/L считаем сами из цен (детерминированно и проверяемо), а не берём
    // expectedYield из API: у API считается по FIFO и может отличаться.
    // Без средней цены P/L не выдумываем — null, а не 0.
    const pnl =
      averagePrice !== null && currentPrice !== null
        ? round2((currentPrice - averagePrice) * quantity)
        : null;
    const pnlPercent =
      averagePrice !== null && averagePrice !== 0 && currentPrice !== null
        ? round2((currentPrice / averagePrice - 1) * 100)
        : null;

    return {
      ticker: p.ticker ?? p.figi, // тикера может не быть — показываем FIGI (презентация)
      name: namesByUid.get(p.instrumentUid) ?? null,
      instrumentType: p.instrumentType,
      quantity,
      averagePrice,
      currentPrice,
      value: currentPrice !== null ? round2(currentPrice * quantity) : null,
      pnl,
      pnlPercent,
      nkdPerUnit: p.currentNkd ? moneyToNumber(p.currentNkd) : null,
      dailyYield: p.dailyYield ? moneyToNumber(p.dailyYield) : null,
    };
  });

  return {
    accountId: resp.accountId,
    currency: resp.totalAmountPortfolio.currency,
    totals: {
      portfolio: moneyToNumber(resp.totalAmountPortfolio),
      shares: moneyToNumber(resp.totalAmountShares),
      bonds: moneyToNumber(resp.totalAmountBonds),
      etf: moneyToNumber(resp.totalAmountEtf),
      currencies: moneyToNumber(resp.totalAmountCurrencies),
    },
    expectedYieldPercent: quotationToNumber(resp.expectedYield),
    dailyYield: resp.dailyYield ? moneyToNumber(resp.dailyYield) : null,
    positions,
  };
}

// Загрузка полных названий инструментов по карточкам (GetPortfolio их не даёт).
// Название — сугубо презентационное поле, поэтому сбой карточки ОДНОГО
// инструмента не должен ронять весь портфель: для него name = null,
// предупреждение уходит в stderr (политика no-fallbacks касается обязательных
// данных; UI-поля она явно разрешает деградировать).
async function loadInstrumentNames(
  api: PortfolioApi,
  uids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(uids)];
  const entries = await Promise.all(
    unique.map(async (uid): Promise<readonly [string, string] | null> => {
      try {
        const { instrument } = await api.getInstrumentByUid(uid);
        return [uid, instrument.name] as const;
      } catch (err) {
        console.error(
          `Предупреждение: не удалось получить название инструмента ${uid}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    }),
  );
  return new Map(entries.filter((e): e is readonly [string, string] => e !== null));
}

export async function fetchPortfolio(api: PortfolioApi, explicitAccountId?: string): Promise<PortfolioView> {
  const accountId = await resolveAccountId(api, explicitAccountId);
  const resp = await api.getPortfolio(accountId);
  const namesByUid = await loadInstrumentNames(api, resp.positions.map((p) => p.instrumentUid));
  return buildPortfolioView(resp, namesByUid);
}

export function renderPortfolio(view: PortfolioView): string {
  // Сводка по портфелю + таблица позиций; «—» — данных нет (не ноль).
  const dash = '—';
  const header = [
    `Счёт: ${view.accountId}`,
    `Стоимость портфеля: ${formatAmount(view.totals.portfolio)} ${view.currency.toUpperCase()}`,
    `Доходность портфеля: ${formatSigned(view.expectedYieldPercent)} %`,
    view.dailyYield !== null ? `Изменение за день: ${formatSigned(view.dailyYield)}` : '',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');

  const table = renderTable(
    ['Тикер', 'Название', 'Тип', 'Кол-во', 'Средняя', 'Текущая', 'Стоимость', 'P/L', 'P/L %'],
    view.positions.map((p) => [
      p.ticker,
      p.name !== null ? truncate(p.name, 28) : dash,
      p.instrumentType,
      formatAmount(p.quantity, 0),
      p.averagePrice !== null ? formatAmount(p.averagePrice) : dash,
      p.currentPrice !== null ? formatAmount(p.currentPrice) : dash,
      p.value !== null ? formatAmount(p.value) : dash,
      p.pnl !== null ? formatSigned(p.pnl) : dash,
      p.pnlPercent !== null ? `${formatSigned(p.pnlPercent)} %` : dash,
    ]),
  );

  return `${header}\n${table}`;
}
