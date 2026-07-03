/**
 * Команда fundamentals: фундаментальные показатели эмитента.
 *
 * Экспорты:
 * - FundamentalsApi — контракт клиента для команды;
 * - FundamentalsView — сгруппированное представление метрик;
 * - metricOrNull(value) — единая трактовка нулевого/незаполненного коэффициента
 *   как «нет данных» → null (общий источник для fundamentals и screen-shares, K42);
 * - fetchFundamentals(api, query) — инструмент → asset_uid → показатели;
 * - renderFundamentals(view) — вывод для терминала.
 *
 * Особенность данных: REST-шлюз протобуфа опускает нулевые числовые поля,
 * поэтому и отсутствие поля, и нулевой double здесь = «данных нет» → null
 * (не ноль!). Показатели предоставляются в основном по акциям; для облигаций
 * и фондов API возвращает пустой ответ — это явная ошибка команды с пояснением.
 */
import { AppError } from '../api/errors.js';
import type {
  GetAssetFundamentalsResponse,
  GetInstrumentByResponse,
} from '../api/types.js';
import { DASH, formatOrDash, percentOrDash } from '../format/values.js';
import { resolveInstrument, type InstrumentSearchApi } from './resolve-instrument.js';

export interface FundamentalsApi extends InstrumentSearchApi {
  getInstrumentByUid(uid: string): Promise<GetInstrumentByResponse>;
  getAssetFundamentals(assetUids: string[]): Promise<GetAssetFundamentalsResponse>;
}

export interface FundamentalsView {
  ticker: string;
  name: string;
  currency: string | null;
  valuation: {
    marketCapitalization: number | null;
    peRatioTtm: number | null;
    priceToBookTtm: number | null;
    priceToSalesTtm: number | null;
    evToEbitdaMrq: number | null;
  };
  profitability: {
    roe: number | null;
    roa: number | null;
    roic: number | null;
    netMarginMrq: number | null;
    epsTtm: number | null;
  };
  dividends: {
    dividendYieldDailyTtm: number | null; // за последние 12 месяцев, %
    forwardAnnualDividendYield: number | null; // прогнозная, %
    fiveYearsAverageDividendYield: number | null;
    dividendPayoutRatioFy: number | null; // доля прибыли на дивиденды, %
    dividendsPerShare: number | null;
  };
  debt: {
    totalDebtToEbitdaMrq: number | null;
    netDebtToEbitda: number | null;
    currentRatioMrq: number | null;
  };
  growth: {
    oneYearAnnualRevenueGrowthRate: number | null;
    threeYearAnnualRevenueGrowthRate: number | null;
    fiveYearAnnualRevenueGrowthRate: number | null;
    epsChangeFiveYears: number | null;
  };
  trading: {
    highPriceLast52Weeks: number | null;
    lowPriceLast52Weeks: number | null;
    beta: number | null;
    freeFloat: number | null; // %
  };
}

/**
 * Единая трактовка значения фундаментального коэффициента (K42).
 *
 * Ловушка API (проверено вживую): REST-шлюз протобуфа опускает нулевые/
 * незаполненные числовые double, поэтому нулевое значение неотличимо от «нет
 * данных». У фундаментальных коэффициентов (P/E, P/S, P/B, EV/EBITDA, ROE,
 * маржа, дивдоходность, капитализация, цены за 52 недели и т.п.) настоящий
 * ноль не является осмысленным фактом, поэтому и `0`, и `undefined` означают
 * одно и то же — «данных нет» → null.
 *
 * Это ЕДИНЫЙ источник трактовки для команд fundamentals и screen-shares:
 * раньше fundamentals сохранял буквальный 0 как факт («P/E 0.00»), а screen-
 * shares трактовал 0 как отсутствие — одна и та же бумага получала
 * противоположные ответы в соседних командах. Здесь трактовка сведена к одной.
 * Осторожно: применять только к коэффициентам/долям/ценам; для гипотетических
 * полей-счётчиков (где 0 осмыслен) нужна отдельная трактовка.
 */
export function metricOrNull(value: number | undefined): number | null {
  return value !== undefined && value !== 0 ? value : null;
}

export async function fetchFundamentals(
  api: FundamentalsApi,
  query: string,
): Promise<FundamentalsView> {
  const resolved = await resolveInstrument(api, query);

  // asset_uid (ключ фундаментальных данных) есть только в полной карточке
  // инструмента — результат поиска его не содержит.
  const { instrument } = await api.getInstrumentByUid(resolved.uid);
  if (!instrument.assetUid) {
    throw new AppError({
      code: 'APP_TINVEST_FUNDAMENTALS_UNAVAILABLE',
      userMessage: `По инструменту «${resolved.ticker}» фундаментальные показатели не предоставляются (обычно они есть только у акций).`,
    });
  }

  const response = await api.getAssetFundamentals([instrument.assetUid]);
  const item = (response.fundamentals ?? [])[0];
  if (!item) {
    throw new AppError({
      code: 'APP_TINVEST_FUNDAMENTALS_UNAVAILABLE',
      userMessage: `T-Invest API не вернул фундаментальные показатели для «${resolved.ticker}» — по этому активу их нет.`,
    });
  }

  // Единая трактовка нуля/отсутствия как «нет данных» — см. metricOrNull.
  return {
    ticker: resolved.ticker,
    name: resolved.name,
    currency: item.currency ?? null,
    valuation: {
      marketCapitalization: metricOrNull(item.marketCapitalization),
      peRatioTtm: metricOrNull(item.peRatioTtm),
      priceToBookTtm: metricOrNull(item.priceToBookTtm),
      priceToSalesTtm: metricOrNull(item.priceToSalesTtm),
      evToEbitdaMrq: metricOrNull(item.evToEbitdaMrq),
    },
    profitability: {
      roe: metricOrNull(item.roe),
      roa: metricOrNull(item.roa),
      roic: metricOrNull(item.roic),
      netMarginMrq: metricOrNull(item.netMarginMrq),
      epsTtm: metricOrNull(item.epsTtm),
    },
    dividends: {
      dividendYieldDailyTtm: metricOrNull(item.dividendYieldDailyTtm),
      forwardAnnualDividendYield: metricOrNull(item.forwardAnnualDividendYield),
      fiveYearsAverageDividendYield: metricOrNull(item.fiveYearsAverageDividendYield),
      dividendPayoutRatioFy: metricOrNull(item.dividendPayoutRatioFy),
      dividendsPerShare: metricOrNull(item.dividendsPerShare),
    },
    debt: {
      totalDebtToEbitdaMrq: metricOrNull(item.totalDebtToEbitdaMrq),
      netDebtToEbitda: metricOrNull(item.netDebtToEbitda),
      currentRatioMrq: metricOrNull(item.currentRatioMrq),
    },
    growth: {
      oneYearAnnualRevenueGrowthRate: metricOrNull(item.oneYearAnnualRevenueGrowthRate),
      threeYearAnnualRevenueGrowthRate: metricOrNull(item.threeYearAnnualRevenueGrowthRate),
      fiveYearAnnualRevenueGrowthRate: metricOrNull(item.fiveYearAnnualRevenueGrowthRate),
      epsChangeFiveYears: metricOrNull(item.epsChangeFiveYears),
    },
    trading: {
      highPriceLast52Weeks: metricOrNull(item.highPriceLast52Weeks),
      lowPriceLast52Weeks: metricOrNull(item.lowPriceLast52Weeks),
      beta: metricOrNull(item.beta),
      freeFloat: metricOrNull(item.freeFloat),
    },
  };
}

export function renderFundamentals(view: FundamentalsView): string {
  // Единый формат «значение или прочерк»: formatOrDash — числа с фикс. точностью,
  // percentOrDash — проценты (см. src/format/values.ts). Локальные dash/num/pct
  // удалены, чтобы символ «нет данных» и формат совпадали со всеми командами.
  // Капитализация читабельнее в миллиардах.
  const cap =
    view.valuation.marketCapitalization !== null
      ? `${(view.valuation.marketCapitalization / 1e9).toFixed(1)} млрд`
      : DASH;

  return [
    `${view.name} (${view.ticker})${view.currency ? `, валюта: ${view.currency}` : ''}`,
    '',
    'Оценка:',
    `  Капитализация: ${cap}  P/E: ${formatOrDash(view.valuation.peRatioTtm)}  P/B: ${formatOrDash(view.valuation.priceToBookTtm)}  P/S: ${formatOrDash(view.valuation.priceToSalesTtm)}  EV/EBITDA: ${formatOrDash(view.valuation.evToEbitdaMrq)}`,
    'Рентабельность:',
    `  ROE: ${percentOrDash(view.profitability.roe)}  ROA: ${percentOrDash(view.profitability.roa)}  Маржа чистой прибыли: ${percentOrDash(view.profitability.netMarginMrq)}  EPS: ${formatOrDash(view.profitability.epsTtm)}`,
    'Дивиденды:',
    `  Доходность TTM: ${percentOrDash(view.dividends.dividendYieldDailyTtm)}  Форвардная: ${percentOrDash(view.dividends.forwardAnnualDividendYield)}  Средняя за 5 лет: ${percentOrDash(view.dividends.fiveYearsAverageDividendYield)}  Payout: ${percentOrDash(view.dividends.dividendPayoutRatioFy)}`,
    'Долг и ликвидность:',
    `  Долг/EBITDA: ${formatOrDash(view.debt.totalDebtToEbitdaMrq)}  Чистый долг/EBITDA: ${formatOrDash(view.debt.netDebtToEbitda)}  Current ratio: ${formatOrDash(view.debt.currentRatioMrq)}`,
    'Рост:',
    `  Выручка 1г: ${percentOrDash(view.growth.oneYearAnnualRevenueGrowthRate)}  3г: ${percentOrDash(view.growth.threeYearAnnualRevenueGrowthRate)}  5л: ${percentOrDash(view.growth.fiveYearAnnualRevenueGrowthRate)}  EPS 5л: ${percentOrDash(view.growth.epsChangeFiveYears)}`,
    'Торговля:',
    `  52 недели: ${formatOrDash(view.trading.lowPriceLast52Weeks)}–${formatOrDash(view.trading.highPriceLast52Weeks)}  Бета: ${formatOrDash(view.trading.beta)}  Free float: ${percentOrDash(view.trading.freeFloat)}`,
  ].join('\n');
}
