/**
 * Команда tech: технические индикаторы по инструменту — RSI, SMA(20/50),
 * MACD; значения считает T-Invest API (GetTechAnalysis), CLI агрегирует
 * последние значения и даёт нейтральные текстовые наблюдения.
 *
 * Экспорты:
 * - TechApi — контракт клиента;
 * - TechView — представление: последние значения индикаторов и наблюдения;
 * - buildTechView(...) — чистая сборка (тестируется без API);
 * - fetchTech(api, query, now) — загрузка индикаторов + сборка;
 * - renderTech(view) — человекочитаемый вывод.
 */
import { quotationToNumber, formatAmount, round } from '../api/money.js';
import type { GetLastPricesResponse } from '../api/types.js';
import type { GetTechAnalysisResponse, TechAnalysisRequest } from '../api/types-market.js';
import {
  RSI_LENGTH,
  RSI_OVERBOUGHT,
  RSI_OVERSOLD,
  SMA_FAST_LENGTH,
  SMA_SLOW_LENGTH,
  MACD_FAST,
  MACD_SLOW,
  MACD_SIGNAL,
  TECH_LOOKBACK_DAYS,
  MS_PER_DAY,
} from '../config/config.js';
import { DASH } from '../format/values.js';
import { resolveMarketInstrument, type MarketInstrumentApi } from './resolve-instrument.js';

export interface TechApi extends MarketInstrumentApi {
  getTechAnalysis(request: TechAnalysisRequest): Promise<GetTechAnalysisResponse>;
  getLastPrices(instrumentIds: string[]): Promise<GetLastPricesResponse>;
}

export interface TechView {
  ticker: string;
  name: string;
  lastPrice: number | null;
  rsi: number | null;
  smaFast: number | null; // SMA(20)
  smaSlow: number | null; // SMA(50)
  macd: number | null;
  macdSignal: number | null;
  observations: string[]; // нейтральные наблюдения, не торговые указания
}

// Последнее значение индикатора из ответа API (поле зависит от типа).
function lastValue(
  resp: GetTechAnalysisResponse,
  field: 'signal' | 'macd' | 'middleBand',
): number | null {
  const values = resp.technicalIndicators ?? [];
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const quotation = values[i]![field];
    if (quotation) {
      return round(quotationToNumber(quotation));
    }
  }
  return null;
}

export function buildTechView(params: {
  ticker: string;
  name: string;
  lastPrice: number | null;
  rsiResp: GetTechAnalysisResponse;
  smaFastResp: GetTechAnalysisResponse;
  smaSlowResp: GetTechAnalysisResponse;
  macdResp: GetTechAnalysisResponse;
}): TechView {
  const rsi = lastValue(params.rsiResp, 'signal');
  const smaFast = lastValue(params.smaFastResp, 'signal');
  const smaSlow = lastValue(params.smaSlowResp, 'signal');
  const macd = lastValue(params.macdResp, 'macd');
  const macdSignal = lastValue(params.macdResp, 'signal');

  // Наблюдения — стандартные пороги теханализа; формулировки нейтральные.
  const observations: string[] = [];
  if (rsi !== null) {
    if (rsi >= RSI_OVERBOUGHT) {
      observations.push(`RSI ${rsi} — зона перекупленности (выше ${RSI_OVERBOUGHT}).`);
    } else if (rsi <= RSI_OVERSOLD) {
      observations.push(`RSI ${rsi} — зона перепроданности (ниже ${RSI_OVERSOLD}).`);
    } else {
      observations.push(`RSI ${rsi} — нейтральная зона.`);
    }
  }
  if (params.lastPrice !== null && smaFast !== null && smaSlow !== null) {
    const above = params.lastPrice > smaFast && params.lastPrice > smaSlow;
    const below = params.lastPrice < smaFast && params.lastPrice < smaSlow;
    if (above) {
      observations.push(`Цена выше SMA${SMA_FAST_LENGTH} и SMA${SMA_SLOW_LENGTH} — восходящая структура.`);
    } else if (below) {
      observations.push(`Цена ниже SMA${SMA_FAST_LENGTH} и SMA${SMA_SLOW_LENGTH} — нисходящая структура.`);
    }
  }
  if (macd !== null && macdSignal !== null) {
    observations.push(
      macd > macdSignal
        ? 'MACD выше сигнальной линии — импульс на стороне роста.'
        : 'MACD ниже сигнальной линии — импульс на стороне снижения.',
    );
  }

  return {
    ticker: params.ticker,
    name: params.name,
    lastPrice: params.lastPrice,
    rsi,
    smaFast,
    smaSlow,
    macd,
    macdSignal,
    observations,
  };
}

export async function fetchTech(api: TechApi, query: string, now: Date): Promise<TechView> {
  // Общий рыночный резолвер: тикер/ISIN, а для индексов (IMOEX/RTSI) — fallback
  // на индикативы, чтобы tech работал по индексам единообразно с history (K44).
  const instrument = await resolveMarketInstrument(api, query);
  const from = new Date(now.getTime() - TECH_LOOKBACK_DAYS * MS_PER_DAY).toISOString();
  const to = now.toISOString();
  const base = {
    instrumentUid: instrument.uid,
    from,
    to,
    interval: 'INDICATOR_INTERVAL_ONE_DAY' as const,
    typeOfPrice: 'TYPE_OF_PRICE_CLOSE' as const,
  };

  // Четыре независимых индикатора — параллельно (в лимиты MarketData влезает).
  const [prices, rsiResp, smaFastResp, smaSlowResp, macdResp] = await Promise.all([
    api.getLastPrices([instrument.uid]),
    api.getTechAnalysis({ ...base, indicatorType: 'INDICATOR_TYPE_RSI', length: RSI_LENGTH }),
    api.getTechAnalysis({ ...base, indicatorType: 'INDICATOR_TYPE_SMA', length: SMA_FAST_LENGTH }),
    api.getTechAnalysis({ ...base, indicatorType: 'INDICATOR_TYPE_SMA', length: SMA_SLOW_LENGTH }),
    api.getTechAnalysis({
      ...base,
      indicatorType: 'INDICATOR_TYPE_MACD',
      smoothing: { fastLength: MACD_FAST, slowLength: MACD_SLOW, signalSmoothing: MACD_SIGNAL },
    }),
  ]);

  const lastPriceQuotation = prices.lastPrices[0]?.price;
  return buildTechView({
    ticker: instrument.ticker,
    name: instrument.name,
    lastPrice: lastPriceQuotation ? round(quotationToNumber(lastPriceQuotation)) : null,
    rsiResp,
    smaFastResp,
    smaSlowResp,
    macdResp,
  });
}

export function renderTech(view: TechView): string {
  const value = (v: number | null): string => (v !== null ? formatAmount(v) : DASH);
  const lines = [
    `${view.ticker} — ${view.name} (дневные индикаторы)`,
    `Цена: ${value(view.lastPrice)}`,
    `RSI(${RSI_LENGTH}): ${value(view.rsi)}`,
    `SMA(${SMA_FAST_LENGTH}): ${value(view.smaFast)} | SMA(${SMA_SLOW_LENGTH}): ${value(view.smaSlow)}`,
    `MACD: ${value(view.macd)} | сигнальная: ${value(view.macdSignal)}`,
  ];
  if (view.observations.length > 0) {
    lines.push('', ...view.observations.map((o) => `• ${o}`));
  }
  return lines.join('\n');
}
