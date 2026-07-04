/**
 * Типы рыночных данных T-Invest API (MarketDataService и связанные
 * методы InstrumentsService).
 *
 * Экспорты:
 * - HistoricCandle, GetCandlesResponse — исторические свечи (GetCandles);
 * - CandleInterval — используемые интервалы свечей;
 * - GetTradingStatusResponse — статус торгов (GetTradingStatus);
 * - OrderBookEntry, GetOrderBookResponse — стакан (GetOrderBook);
 * - TechIndicatorValue, GetTechAnalysisResponse — техиндикаторы (GetTechAnalysis);
 * - TechIndicatorType, TechIndicatorInterval — параметры запроса индикаторов;
 * - GetFuturesMarginResponse — гарантийное обеспечение фьючерса.
 *
 * Как и везде: protobuf-JSON опускает незаполненные поля — всё optional.
 */
import type { MoneyValue, Quotation } from './types.js';

// --- MarketDataService/GetCandles ---

// Интервалы, которые использует CLI (контракт API шире).
export type CandleInterval =
  | 'CANDLE_INTERVAL_HOUR'
  | 'CANDLE_INTERVAL_DAY'
  | 'CANDLE_INTERVAL_WEEK'
  | 'CANDLE_INTERVAL_MONTH';

export interface HistoricCandle {
  open?: Quotation;
  high?: Quotation;
  low?: Quotation;
  close?: Quotation;
  volume?: string; // int64 → string
  time: string;
  isComplete?: boolean;
}

export interface GetCandlesResponse {
  candles?: HistoricCandle[];
}

// --- MarketDataService/GetTradingStatus ---

export interface GetTradingStatusResponse {
  figi?: string;
  instrumentUid?: string;
  tradingStatus?: string; // SECURITY_TRADING_STATUS_NORMAL_TRADING | ...
  limitOrderAvailableFlag?: boolean;
  marketOrderAvailableFlag?: boolean;
  apiTradeAvailableFlag?: boolean;
}

// --- MarketDataService/GetOrderBook ---

export interface OrderBookEntry {
  price?: Quotation;
  quantity?: string; // лоты, int64 → string
}

export interface GetOrderBookResponse {
  figi?: string;
  instrumentUid?: string;
  depth?: number;
  bids?: OrderBookEntry[]; // заявки на покупку (по убыванию цены)
  asks?: OrderBookEntry[]; // заявки на продажу (по возрастанию цены)
  lastPrice?: Quotation;
  closePrice?: Quotation;
  limitUp?: Quotation; // верхняя планка цены
  limitDown?: Quotation;
}

// --- MarketDataService/GetTechAnalysis ---

export type TechIndicatorType =
  | 'INDICATOR_TYPE_SMA'
  | 'INDICATOR_TYPE_EMA'
  | 'INDICATOR_TYPE_RSI'
  | 'INDICATOR_TYPE_MACD'
  | 'INDICATOR_TYPE_BB';

export type TechIndicatorInterval =
  | 'INDICATOR_INTERVAL_ONE_HOUR'
  | 'INDICATOR_INTERVAL_ONE_DAY'
  | 'INDICATOR_INTERVAL_ONE_WEEK';

export interface TechAnalysisRequest {
  indicatorType: TechIndicatorType;
  instrumentUid: string;
  from: string;
  to: string;
  interval: TechIndicatorInterval;
  typeOfPrice: 'TYPE_OF_PRICE_CLOSE';
  length?: number; // период индикатора (SMA/EMA/RSI/BB)
  deviation?: { deviationMultiplier: Quotation }; // для BB
  smoothing?: { fastLength: number; slowLength: number; signalSmoothing: number }; // для MACD
}

// Значение индикатора в точке времени: заполненные поля зависят от типа
// (у RSI/SMA/EMA — signal, у MACD — macd+signal, у BB — три полосы).
export interface TechIndicatorValue {
  timestamp: string;
  signal?: Quotation;
  macd?: Quotation;
  middleBand?: Quotation;
  upperBand?: Quotation;
  lowerBand?: Quotation;
}

export interface GetTechAnalysisResponse {
  technicalIndicators?: TechIndicatorValue[];
}

// --- InstrumentsService/GetFuturesMargin ---

export interface GetFuturesMarginResponse {
  initialMarginOnBuy?: MoneyValue; // ГО на покупку одного контракта
  initialMarginOnSell?: MoneyValue;
  minPriceIncrement?: Quotation; // шаг цены
  minPriceIncrementAmount?: Quotation; // стоимость шага цены
}

// --- InstrumentsService/TradingSchedules ---

// Один торговый день площадки. Все времена — UTC (в выводе переводим в МСК).
// Берём только основную и вечернюю сессии — их достаточно для ответа «когда
// открыты торги»; аукционы/клиринг/премаркет из контракта опускаем.
export interface TradingDay {
  date?: string;
  isTradingDay?: boolean;
  startTime?: string; // начало основной сессии
  endTime?: string; // конец основной сессии
  eveningStartTime?: string; // начало вечерней сессии (если есть)
  eveningEndTime?: string;
}

export interface TradingSchedule {
  exchange?: string;
  days?: TradingDay[];
}

export interface TradingSchedulesResponse {
  exchanges?: TradingSchedule[];
}

// --- MarketDataService/GetLastTrades ---

// Обезличенная сделка из ленты рынка. Цена — за 1 инструмент в его котировке
// (для облигаций/фьючерсов — в пунктах), quantity — в лотах.
export interface MarketTrade {
  direction?: string; // TRADE_DIRECTION_BUY | _SELL | _UNSPECIFIED
  price?: Quotation;
  quantity?: string; // лоты, int64 → string
  time?: string; // UTC
  tradeSource?: string; // TRADE_SOURCE_EXCHANGE | _DEALER | ...
}

export interface GetLastTradesResponse {
  trades?: MarketTrade[];
}
