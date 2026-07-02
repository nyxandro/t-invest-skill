/**
 * Типы информационного слоя T-Invest API: новости, сделки инсайдеров,
 * календарь отчётностей, сигналы стратегий, избранное.
 *
 * Экспорты:
 * - NewsItem, NewsResponse — лента новостей (InstrumentsService/News);
 * - InsiderDeal, GetInsiderDealsResponse — сделки инсайдеров (GetInsiderDeals);
 * - AssetReportEvent, GetAssetReportsResponse — отчётности (GetAssetReports);
 * - SignalStrategy, GetStrategiesResponse — стратегии (SignalService/GetStrategies);
 * - Signal, GetSignalsResponse — сигналы (SignalService/GetSignals);
 * - FavoriteInstrument, GetFavoritesResponse — избранное (GetFavorites).
 *
 * Контракты проверены живыми вызовами 2026-07-02. ВАЖНО: сервер НЕ фильтрует
 * ленту News по инструменту — привязка к бумагам лежит в item.instrumentId[],
 * фильтрация выполняется на клиенте.
 */
import type { Quotation } from './types.js';

// --- InstrumentsService/News ---

export interface NewsInstrumentRef {
  instrument?: {
    instrumentUid?: string;
    ticker?: string;
    classCode?: string;
  };
}

export interface NewsItem {
  id: string;
  source?: string; // tass | interfax | ...
  title?: string;
  content?: string;
  instrumentId?: NewsInstrumentRef[]; // бумаги, к которым привязана новость
  priority?: boolean;
  ts: string;
}

export interface NewsResponse {
  hasNext?: boolean;
  nextCursor?: string;
  items?: NewsItem[];
}

// --- InstrumentsService/GetInsiderDeals ---

export interface InsiderDeal {
  tradeId?: string;
  direction?: string; // TRADE_DIRECTION_BUY | TRADE_DIRECTION_SELL
  currency?: string; // «RUR» — нестандартный код из раскрытия
  date?: string;
  quantity?: string; // int64 → string
  price?: Quotation;
  instrumentUid?: string;
  ticker?: string;
  investorName?: string;
  investorPosition?: string; // «Эмитент», «Член Правления», ...
  percentage?: number; // доля сделки от капитала (может прийти в exp-нотации)
  isOptionExecution?: boolean;
  disclosureDate?: string;
}

export interface GetInsiderDealsResponse {
  insiderDeals?: InsiderDeal[];
  nextCursor?: string;
}

// --- InstrumentsService/GetAssetReports ---

export interface AssetReportEvent {
  instrumentId?: string; // uid инструмента
  reportDate?: string;
  periodYear?: number;
  periodNum?: number;
  periodType?: string; // PERIOD_TYPE_QUARTER | _SEMIANNUAL | _ANNUAL
  createdAt?: string;
}

export interface GetAssetReportsResponse {
  events?: AssetReportEvent[];
}

// --- SignalService ---

export interface SignalStrategy {
  strategyId: string;
  strategyName?: string;
  strategyDescription?: string;
  strategyUrl?: string;
  strategyType?: string; // STRATEGY_TYPE_TECHNICAL | _FUNDAMENTAL
  activeSignals?: number;
  totalSignals?: number;
}

export interface GetStrategiesResponse {
  strategies?: SignalStrategy[];
}

export interface Signal {
  signalId: string;
  strategyId?: string;
  strategyName?: string;
  instrumentUid?: string;
  createDt?: string;
  direction?: string; // SIGNAL_DIRECTION_BUY | SIGNAL_DIRECTION_SELL
  initialPrice?: Quotation;
  name?: string; // заголовок идеи
  info?: string;
  targetPrice?: Quotation;
  endDt?: string;
  probability?: number; // оценка вероятности от стратегии, %
  stoploss?: Quotation;
  closePrice?: Quotation;
  closeDt?: string;
}

export interface GetSignalsResponse {
  signals?: Signal[];
}

// --- InstrumentsService/GetFavorites ---

export interface FavoriteInstrument {
  uid: string;
  figi?: string;
  ticker?: string;
  classCode?: string;
  isin?: string;
  instrumentType?: string;
  name?: string;
  otcFlag?: boolean;
  apiTradeAvailableFlag?: boolean;
  instrumentKind?: string;
}

export interface GetFavoritesResponse {
  favoriteInstruments?: FavoriteInstrument[];
  groupId?: string;
}
