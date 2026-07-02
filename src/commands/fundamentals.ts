/**
 * Команда fundamentals: фундаментальные показатели эмитента.
 *
 * Экспорты:
 * - FundamentalsApi — контракт клиента для команды;
 * - FundamentalsView — сгруппированное представление метрик;
 * - fetchFundamentals(api, query) — инструмент → asset_uid → показатели;
 * - renderFundamentals(view) — вывод для терминала.
 *
 * Особенность данных: REST-шлюз протобуфа опускает нулевые числовые поля,
 * поэтому отсутствие поля здесь = «данных нет» → null (не ноль!).
 * Показатели предоставляются в основном по акциям; для облигаций и фондов
 * API возвращает пустой ответ — это явная ошибка команды с пояснением.
 */
import { AppError } from '../api/errors.js';
import type {
  GetAssetFundamentalsResponse,
  GetInstrumentByResponse,
} from '../api/types.js';
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

  // Протобуф опускает нулевые double — переводим отсутствие в null явно.
  const orNull = (value: number | undefined): number | null => value ?? null;
  return {
    ticker: resolved.ticker,
    name: resolved.name,
    currency: item.currency ?? null,
    valuation: {
      marketCapitalization: orNull(item.marketCapitalization),
      peRatioTtm: orNull(item.peRatioTtm),
      priceToBookTtm: orNull(item.priceToBookTtm),
      priceToSalesTtm: orNull(item.priceToSalesTtm),
      evToEbitdaMrq: orNull(item.evToEbitdaMrq),
    },
    profitability: {
      roe: orNull(item.roe),
      roa: orNull(item.roa),
      roic: orNull(item.roic),
      netMarginMrq: orNull(item.netMarginMrq),
      epsTtm: orNull(item.epsTtm),
    },
    dividends: {
      dividendYieldDailyTtm: orNull(item.dividendYieldDailyTtm),
      forwardAnnualDividendYield: orNull(item.forwardAnnualDividendYield),
      fiveYearsAverageDividendYield: orNull(item.fiveYearsAverageDividendYield),
      dividendPayoutRatioFy: orNull(item.dividendPayoutRatioFy),
      dividendsPerShare: orNull(item.dividendsPerShare),
    },
    debt: {
      totalDebtToEbitdaMrq: orNull(item.totalDebtToEbitdaMrq),
      netDebtToEbitda: orNull(item.netDebtToEbitda),
      currentRatioMrq: orNull(item.currentRatioMrq),
    },
    growth: {
      oneYearAnnualRevenueGrowthRate: orNull(item.oneYearAnnualRevenueGrowthRate),
      threeYearAnnualRevenueGrowthRate: orNull(item.threeYearAnnualRevenueGrowthRate),
      fiveYearAnnualRevenueGrowthRate: orNull(item.fiveYearAnnualRevenueGrowthRate),
      epsChangeFiveYears: orNull(item.epsChangeFiveYears),
    },
    trading: {
      highPriceLast52Weeks: orNull(item.highPriceLast52Weeks),
      lowPriceLast52Weeks: orNull(item.lowPriceLast52Weeks),
      beta: orNull(item.beta),
      freeFloat: orNull(item.freeFloat),
    },
  };
}

export function renderFundamentals(view: FundamentalsView): string {
  const dash = '—';
  const num = (v: number | null, digits = 2): string => (v !== null ? v.toFixed(digits) : dash);
  const pct = (v: number | null): string => (v !== null ? `${v.toFixed(2)}%` : dash);
  // Капитализация читабельнее в миллиардах.
  const cap =
    view.valuation.marketCapitalization !== null
      ? `${(view.valuation.marketCapitalization / 1e9).toFixed(1)} млрд`
      : dash;

  return [
    `${view.name} (${view.ticker})${view.currency ? `, валюта: ${view.currency}` : ''}`,
    '',
    'Оценка:',
    `  Капитализация: ${cap}  P/E: ${num(view.valuation.peRatioTtm)}  P/B: ${num(view.valuation.priceToBookTtm)}  P/S: ${num(view.valuation.priceToSalesTtm)}  EV/EBITDA: ${num(view.valuation.evToEbitdaMrq)}`,
    'Рентабельность:',
    `  ROE: ${pct(view.profitability.roe)}  ROA: ${pct(view.profitability.roa)}  Маржа чистой прибыли: ${pct(view.profitability.netMarginMrq)}  EPS: ${num(view.profitability.epsTtm)}`,
    'Дивиденды:',
    `  Доходность TTM: ${pct(view.dividends.dividendYieldDailyTtm)}  Форвардная: ${pct(view.dividends.forwardAnnualDividendYield)}  Средняя за 5 лет: ${pct(view.dividends.fiveYearsAverageDividendYield)}  Payout: ${pct(view.dividends.dividendPayoutRatioFy)}`,
    'Долг и ликвидность:',
    `  Долг/EBITDA: ${num(view.debt.totalDebtToEbitdaMrq)}  Чистый долг/EBITDA: ${num(view.debt.netDebtToEbitda)}  Current ratio: ${num(view.debt.currentRatioMrq)}`,
    'Рост:',
    `  Выручка 1г: ${pct(view.growth.oneYearAnnualRevenueGrowthRate)}  3г: ${pct(view.growth.threeYearAnnualRevenueGrowthRate)}  5л: ${pct(view.growth.fiveYearAnnualRevenueGrowthRate)}  EPS 5л: ${pct(view.growth.epsChangeFiveYears)}`,
    'Торговля:',
    `  52 недели: ${num(view.trading.lowPriceLast52Weeks)}–${num(view.trading.highPriceLast52Weeks)}  Бета: ${num(view.trading.beta)}  Free float: ${pct(view.trading.freeFloat)}`,
  ].join('\n');
}
