/**
 * Команда history: динамика цены инструмента за период — свечи, изменение,
 * диапазон, волатильность; опционально сравнение с бенчмарком (--vs, IMOEX).
 *
 * Экспорты:
 * - HistoryApi — контракт клиента;
 * - pickCandleInterval(days) — выбор интервала под лимиты API;
 * - computeCandleStats(candles, interval) — чистая статистика по свечам;
 * - fetchHistory(api, params) — загрузка + сборка представления;
 * - renderHistory(view) — человекочитаемый отчёт.
 *
 * Резолв инструмента (в т.ч. индексов IMOEX/RTSI через индикативы) вынесен в
 * общий resolveMarketInstrument из resolve-instrument.ts — единый для всех
 * рыночных команд.
 */
import { AppError } from '../api/errors.js';
import { formatAmount, formatSigned, quotationToNumber, round } from '../api/money.js';
import type { CandleInterval, GetCandlesResponse, HistoricCandle } from '../api/types-market.js';
import {
  CANDLES_HOUR_MAX_DAYS,
  CANDLES_DAY_MAX_DAYS,
  CANDLES_WEEK_MAX_DAYS,
  CANDLES_MONTH_MAX_DAYS,
  TRADING_DAYS_PER_YEAR,
  WEEKS_PER_YEAR,
  MONTHS_PER_YEAR,
  MS_PER_DAY,
} from '../config/config.js';
import { DASH } from '../format/values.js';
import { resolveMarketInstrument, type MarketInstrumentApi } from './resolve-instrument.js';

export interface HistoryApi extends MarketInstrumentApi {
  getCandles(params: {
    instrumentId: string;
    from: string;
    to: string;
    interval: CandleInterval;
  }): Promise<GetCandlesResponse>;
}

export interface CandleView {
  time: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface CandleStats {
  candlesCount: number;
  firstClose: number | null;
  lastClose: number | null;
  changePercent: number | null;
  minLow: number | null;
  maxHigh: number | null;
  // Где текущая цена внутри диапазона периода: 0% — у минимума, 100% — у максимума.
  positionInRangePercent: number | null;
  // Годовая волатильность из стандартного отклонения доходностей свечей.
  annualizedVolatilityPercent: number | null;
  avgVolume: number | null;
}

export interface HistoryView {
  ticker: string;
  name: string;
  instrumentKind: 'instrument' | 'indicative';
  from: string;
  to: string;
  interval: CandleInterval;
  stats: CandleStats;
  candles: CandleView[];
  benchmark: { ticker: string; name: string; changePercent: number | null; outperformancePercent: number | null } | null;
}

// Лимиты GetCandles на глубину одного запроса зависят от интервала —
// выбираем самый детальный интервал, влезающий в один запрос.
export function pickCandleInterval(days: number): CandleInterval {
  if (days <= CANDLES_HOUR_MAX_DAYS) {
    return 'CANDLE_INTERVAL_HOUR';
  }
  if (days <= CANDLES_DAY_MAX_DAYS) {
    return 'CANDLE_INTERVAL_DAY';
  }
  if (days <= CANDLES_WEEK_MAX_DAYS) {
    return 'CANDLE_INTERVAL_WEEK';
  }
  if (days <= CANDLES_MONTH_MAX_DAYS) {
    return 'CANDLE_INTERVAL_MONTH';
  }
  throw new AppError({
    code: 'APP_CLI_INVALID_ARGUMENT',
    userMessage: `Период --days не может превышать ${CANDLES_MONTH_MAX_DAYS} дней (лимит глубины истории).`,
  });
}

// Годовых периодов в интервале — для аннуализации волатильности.
function periodsPerYear(interval: CandleInterval): number | null {
  switch (interval) {
    case 'CANDLE_INTERVAL_DAY':
      return TRADING_DAYS_PER_YEAR;
    case 'CANDLE_INTERVAL_WEEK':
      return WEEKS_PER_YEAR;
    case 'CANDLE_INTERVAL_MONTH':
      return MONTHS_PER_YEAR;
    default:
      return null; // для часовых свечей аннуализация вводит в заблуждение
  }
}

export function toCandleViews(candles: HistoricCandle[]): CandleView[] {
  return candles.map((c) => ({
    time: c.time,
    open: c.open ? quotationToNumber(c.open) : null,
    high: c.high ? quotationToNumber(c.high) : null,
    low: c.low ? quotationToNumber(c.low) : null,
    close: c.close ? quotationToNumber(c.close) : null,
    volume: c.volume ? Number(c.volume) : null,
  }));
}

export function computeCandleStats(candles: CandleView[], interval: CandleInterval): CandleStats {
  const closes = candles.map((c) => c.close).filter((v): v is number => v !== null);
  const lows = candles.map((c) => c.low).filter((v): v is number => v !== null);
  const highs = candles.map((c) => c.high).filter((v): v is number => v !== null);
  const volumes = candles.map((c) => c.volume).filter((v): v is number => v !== null);

  const firstClose = closes.length > 0 ? closes[0]! : null;
  const lastClose = closes.length > 0 ? closes[closes.length - 1]! : null;
  const minLow = lows.length > 0 ? Math.min(...lows) : null;
  const maxHigh = highs.length > 0 ? Math.max(...highs) : null;

  // Волатильность: стандартное отклонение логарифмических доходностей,
  // аннуализированное корнем из числа периодов в году.
  let annualizedVolatilityPercent: number | null = null;
  const perYear = periodsPerYear(interval);
  if (perYear !== null && closes.length >= 3) {
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i += 1) {
      if (closes[i - 1]! > 0 && closes[i]! > 0) {
        returns.push(Math.log(closes[i]! / closes[i - 1]!));
      }
    }
    if (returns.length >= 2) {
      const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
      const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
      annualizedVolatilityPercent = round(Math.sqrt(variance) * Math.sqrt(perYear) * 100);
    }
  }

  return {
    candlesCount: candles.length,
    firstClose,
    lastClose,
    changePercent:
      firstClose !== null && firstClose !== 0 && lastClose !== null
        ? round((lastClose / firstClose - 1) * 100)
        : null,
    minLow,
    maxHigh,
    positionInRangePercent:
      lastClose !== null && minLow !== null && maxHigh !== null && maxHigh > minLow
        ? round(((lastClose - minLow) / (maxHigh - minLow)) * 100)
        : null,
    annualizedVolatilityPercent,
    avgVolume:
      volumes.length > 0 ? Math.round(volumes.reduce((s, v) => s + v, 0) / volumes.length) : null,
  };
}

export async function fetchHistory(
  api: HistoryApi,
  params: { query: string; days: number; vs?: string; now: Date },
): Promise<HistoryView> {
  // K40: чистая валидация периода выполняется ДО любых сетевых вызовов —
  // при слишком большом --days pickCandleInterval бросит APP_CLI_INVALID_ARGUMENT
  // сразу, не потратив ни одного запроса к API (резолв, свечи).
  const interval = pickCandleInterval(params.days);
  const from = new Date(params.now.getTime() - params.days * MS_PER_DAY).toISOString();
  const to = params.now.toISOString();

  // Загрузка одной серии: резолв рыночного инструмента (тикер/ISIN или индекс)
  // + свечи в общем окне/интервале. Инкапсулирует одинаковую логику для
  // основного инструмента и бенчмарка, чтобы их можно было грузить параллельно.
  const loadSeries = async (query: string) => {
    const instrument = await resolveMarketInstrument(api, query);
    const resp = await api.getCandles({ instrumentId: instrument.uid, from, to, interval });
    const candles = toCandleViews(resp.candles ?? []);
    return { instrument, candles, stats: computeCandleStats(candles, interval) };
  };

  // K38: основной инструмент и бенчмарк (--vs) независимы — грузим параллельно,
  // а не последовательно, чтобы вдвое сократить время при сравнении с индексом.
  const [main, bench] = await Promise.all([
    loadSeries(params.query),
    params.vs ? loadSeries(params.vs) : Promise.resolve(null),
  ]);

  // Бенчмарк: то же окно и интервал, сравнение по изменению за период.
  let benchmark: HistoryView['benchmark'] = null;
  if (bench) {
    benchmark = {
      ticker: bench.instrument.ticker,
      name: bench.instrument.name,
      changePercent: bench.stats.changePercent,
      outperformancePercent:
        main.stats.changePercent !== null && bench.stats.changePercent !== null
          ? round(main.stats.changePercent - bench.stats.changePercent)
          : null,
    };
  }

  return {
    ticker: main.instrument.ticker,
    name: main.instrument.name,
    instrumentKind: main.instrument.kind,
    from,
    to,
    interval,
    stats: main.stats,
    candles: main.candles,
    benchmark,
  };
}

export function renderHistory(view: HistoryView): string {
  const s = view.stats;
  const lines = [
    `${view.ticker} — ${view.name}`,
    `Период: ${view.from.slice(0, 10)} — ${view.to.slice(0, 10)} (свечи: ${view.interval.replace('CANDLE_INTERVAL_', '').toLowerCase()})`,
    '',
    `Изменение за период: ${s.changePercent !== null ? `${formatSigned(s.changePercent)} %` : DASH}`,
    `Первая/последняя цена: ${s.firstClose !== null ? formatAmount(s.firstClose) : DASH} → ${s.lastClose !== null ? formatAmount(s.lastClose) : DASH}`,
    `Диапазон: ${s.minLow !== null ? formatAmount(s.minLow) : DASH} … ${s.maxHigh !== null ? formatAmount(s.maxHigh) : DASH}` +
      (s.positionInRangePercent !== null ? ` (цена на ${formatAmount(s.positionInRangePercent, 0)}% диапазона)` : ''),
    `Волатильность (годовая): ${s.annualizedVolatilityPercent !== null ? `${formatAmount(s.annualizedVolatilityPercent)} %` : DASH}`,
    `Средний объём за свечу: ${s.avgVolume !== null ? formatAmount(s.avgVolume, 0) : DASH}`,
  ];
  if (view.benchmark) {
    lines.push(
      '',
      `Бенчмарк ${view.benchmark.ticker} (${view.benchmark.name}): ` +
        `${view.benchmark.changePercent !== null ? `${formatSigned(view.benchmark.changePercent)} %` : DASH}` +
        (view.benchmark.outperformancePercent !== null
          ? `, отставание/опережение: ${formatSigned(view.benchmark.outperformancePercent)} п.п.`
          : ''),
    );
  }
  return lines.join('\n');
}
