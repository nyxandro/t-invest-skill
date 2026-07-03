/**
 * Команда portfolio: состав портфеля, стоимость и P/L позиций.
 *
 * Экспорты:
 * - PortfolioApi — контракт клиента для команды;
 * - PortfolioPositionView, PortfolioTotals, PortfolioView — представление;
 * - buildPortfolioView(resp, namesByUid?) — конвертация ответа API в представление;
 * - fetchPortfolio(api, explicitAccountId?) — выбор счёта + загрузка +
 *   обогащение позиций полными названиями инструментов + сборка;
 * - renderPortfolio(view) — человекочитаемый вывод (сводка + таблица);
 * - renderPortfolioChart(view) — ASCII-бары позиций по стоимости (вклад в портфель).
 */
import {
  currencySymbol,
  formatAmount,
  formatSigned,
  moneyToNumber,
  moneyToNumberOrNull,
  quotationToNumber,
  quotationToNumberOrNull,
  round,
} from '../api/money.js';
import type { GetInstrumentByResponse, PortfolioResponse } from '../api/types.js';
import { BATCH_CONCURRENCY, BATCH_MIN_INTERVAL_MS } from '../config/config.js';
import { barChart, type BarChartItem } from '../format/charts.js';
import { renderTable, truncate } from '../format/table.js';
import { DASH, moneyOrDash } from '../format/values.js';
import { mapWithConcurrency } from '../util/concurrency.js';
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
  expectedYieldPercent: number | null; // null — шлюз опустил поле (нулевая доходность)
  dailyYield: number | null;
  positions: PortfolioPositionView[];
}

export function buildPortfolioView(
  resp: PortfolioResponse,
  namesByUid: ReadonlyMap<string, string> = new Map(),
): PortfolioView {
  const positions = resp.positions.map((p): PortfolioPositionView => {
    const quantity = quotationToNumber(p.quantity);
    // Опущенные protobuf-JSON message-поля → null (цены/НКД может не быть).
    const averagePrice = moneyToNumberOrNull(p.averagePositionPrice);
    const currentPrice = moneyToNumberOrNull(p.currentPrice);

    // P/L считаем сами из цен (детерминированно и проверяемо), а не берём
    // expectedYield из API: у API считается по FIFO и может отличаться.
    // Без средней цены P/L не выдумываем — null, а не 0.
    const pnl =
      averagePrice !== null && currentPrice !== null
        ? round((currentPrice - averagePrice) * quantity)
        : null;
    const pnlPercent =
      averagePrice !== null && averagePrice !== 0 && currentPrice !== null
        ? round((currentPrice / averagePrice - 1) * 100)
        : null;

    return {
      ticker: p.ticker ?? p.figi, // тикера может не быть — показываем FIGI (презентация)
      name: namesByUid.get(p.instrumentUid) ?? null,
      instrumentType: p.instrumentType,
      quantity,
      averagePrice,
      currentPrice,
      value: currentPrice !== null ? round(currentPrice * quantity) : null,
      pnl,
      pnlPercent,
      nkdPerUnit: moneyToNumberOrNull(p.currentNkd),
      dailyYield: moneyToNumberOrNull(p.dailyYield),
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
    // expectedYield — message-поле Quotation: при нулевой доходности шлюз его
    // опускает (та же ловушка, что с price/time), поэтому нормализуем в null.
    expectedYieldPercent: quotationToNumberOrNull(resp.expectedYield),
    dailyYield: moneyToNumberOrNull(resp.dailyYield),
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
  // Троттлинг батча: на большом портфеле неограниченный Promise.all даёт залп
  // унарных GetInstrumentBy и упирается в лимиты API (429). Грузим с пулом
  // воркеров и минимальным интервалом между стартами (как income). Имя —
  // презентационное поле, поэтому сбой ОДНОЙ карточки деградирует в null
  // (не денежные данные) и не роняет портфель; но залп без троттлинга недопустим.
  const throttle = { concurrency: BATCH_CONCURRENCY, minIntervalMs: BATCH_MIN_INTERVAL_MS };
  const entries = await mapWithConcurrency(
    unique,
    throttle,
    async (uid): Promise<readonly [string, string] | null> => {
      try {
        const { instrument } = await api.getInstrumentByUid(uid);
        return [uid, instrument.name] as const;
      } catch (err) {
        console.error(
          `Предупреждение: не удалось получить название инструмента ${uid}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    },
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
  // Сводка по портфелю + таблица позиций; DASH — данных нет (не ноль).
  const header = [
    `Счёт: ${view.accountId}`,
    `Стоимость портфеля: ${formatAmount(view.totals.portfolio)} ${view.currency.toUpperCase()}`,
    `Доходность портфеля: ${view.expectedYieldPercent !== null ? `${formatSigned(view.expectedYieldPercent)} %` : DASH}`,
    view.dailyYield !== null ? `Изменение за день: ${formatSigned(view.dailyYield)}` : '',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');

  const table = renderTable(
    ['Тикер', 'Название', 'Тип', 'Кол-во', 'Средняя', 'Текущая', 'Стоимость', 'P/L', 'P/L %'],
    view.positions.map((p) => [
      p.ticker,
      p.name !== null ? truncate(p.name, 28) : DASH,
      p.instrumentType,
      formatAmount(p.quantity, 0),
      moneyOrDash(p.averagePrice),
      moneyOrDash(p.currentPrice),
      moneyOrDash(p.value),
      // P/L — со знаком «+», поэтому formatSigned, а не moneyOrDash.
      p.pnl !== null ? formatSigned(p.pnl) : DASH,
      p.pnlPercent !== null ? `${formatSigned(p.pnlPercent)} %` : DASH,
    ]),
  );

  return `${header}\n${table}`;
}

// Позиция с известной стоимостью (не валюта/кэш) — предикат сужает value к number,
// чтобы бары строились без прочерков и без выдуманных нулей.
function hasChartableValue(
  position: PortfolioPositionView,
): position is PortfolioPositionView & { value: number } {
  return position.value !== null && position.instrumentType !== 'currency';
}

// Бары позиций по стоимости: наглядно показывают вклад каждой бумаги в портфель
// («что занимает больше»). P/L остаётся в таблице — здесь только величины стоимости.
export function renderPortfolioChart(view: PortfolioView): string {
  const positions = view.positions.filter(hasChartableValue).sort((a, b) => b.value - a.value);
  if (positions.length === 0) {
    return 'График недоступен: нет позиций с оценкой стоимости.';
  }
  const currency = currencySymbol(view.currency);
  const items: BarChartItem[] = positions.map((p) => ({
    label: p.ticker,
    value: p.value,
    note: `${formatAmount(p.value, 0)} ${currency}`,
  }));
  return ['Позиции по стоимости (вклад в портфель):', barChart(items)].join('\n');
}
