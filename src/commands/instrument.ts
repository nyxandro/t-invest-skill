/**
 * Команда instrument: универсальная карточка любого актива — акции, фонда,
 * фьючерса, валюты, опциона (для облигаций подробнее команда bond).
 *
 * Экспорты:
 * - InstrumentCardApi — контракт клиента;
 * - InstrumentCardView — представление карточки;
 * - TRADING_STATUS_LABELS — русские подписи статусов торгов;
 * - buildInstrumentCard(...) — чистая сборка представления;
 * - fetchInstrumentCard(api, query) — резолв + карточка + цена + статус
 *   (+ гарантийное обеспечение для фьючерса);
 * - renderInstrumentCard(view) — человекочитаемый вывод.
 */
import { moneyToNumber, quotationToNumber, formatAmount } from '../api/money.js';
import type {
  GetInstrumentByResponse,
  GetLastPricesResponse,
  InstrumentDetails,
  LastPrice,
} from '../api/types.js';
import type { GetFuturesMarginResponse, GetTradingStatusResponse } from '../api/types-market.js';
import { resolveInstrument, type InstrumentSearchApi } from './resolve-instrument.js';

export interface InstrumentCardApi extends InstrumentSearchApi {
  getInstrumentByUid(uid: string): Promise<GetInstrumentByResponse>;
  getLastPrices(instrumentIds: string[]): Promise<GetLastPricesResponse>;
  getTradingStatus(instrumentId: string): Promise<GetTradingStatusResponse>;
  getFuturesMargin(instrumentId: string): Promise<GetFuturesMarginResponse>;
}

// Русские подписи статусов торгов (наиболее частые значения enum).
export const TRADING_STATUS_LABELS: Record<string, string> = {
  SECURITY_TRADING_STATUS_NORMAL_TRADING: 'идут торги',
  SECURITY_TRADING_STATUS_NOT_AVAILABLE_FOR_TRADING: 'торги недоступны',
  SECURITY_TRADING_STATUS_OPENING_PERIOD: 'период открытия',
  SECURITY_TRADING_STATUS_CLOSING_PERIOD: 'период закрытия',
  SECURITY_TRADING_STATUS_BREAK_IN_TRADING: 'перерыв в торгах',
  SECURITY_TRADING_STATUS_OPENING_AUCTION: 'аукцион открытия',
  SECURITY_TRADING_STATUS_CLOSING_AUCTION: 'аукцион закрытия',
  SECURITY_TRADING_STATUS_DARK_POOL_AUCTION: 'аукцион крупных пакетов',
  SECURITY_TRADING_STATUS_DISCRETE_AUCTION: 'дискретный аукцион',
  SECURITY_TRADING_STATUS_TRADING_AT_CLOSING_AUCTION_PRICE: 'торги по цене закрытия',
  SECURITY_TRADING_STATUS_SESSION_CLOSE: 'сессия закрыта',
  SECURITY_TRADING_STATUS_SESSION_OPEN: 'сессия открыта',
};

export interface FuturesMarginView {
  initialMarginOnBuy: number | null;
  initialMarginOnSell: number | null;
  minPriceIncrement: number | null;
  minPriceIncrementAmount: number | null;
}

export interface InstrumentCardView {
  uid: string;
  ticker: string | null;
  isin: string | null;
  name: string;
  instrumentType: string | null;
  lot: number | null;
  currency: string | null;
  exchange: string | null;
  countryOfRisk: string | null;
  lastPrice: number | null;
  tradingStatus: string | null; // enum как есть (для JSON)
  tradingStatusText: string | null; // русская подпись
  apiTradeAvailable: boolean | null;
  forQualInvestor: boolean | null;
  futuresMargin: FuturesMarginView | null; // только для фьючерсов
}

export function buildInstrumentCard(params: {
  details: InstrumentDetails;
  lastPrice: LastPrice | undefined;
  status: GetTradingStatusResponse;
  futuresMargin: GetFuturesMarginResponse | null;
}): InstrumentCardView {
  const { details, lastPrice, status, futuresMargin } = params;
  const statusEnum = status.tradingStatus ?? null;
  return {
    uid: details.uid,
    ticker: details.ticker ?? null,
    isin: details.isin ?? null,
    name: details.name,
    instrumentType: details.instrumentType ?? null,
    lot: details.lot ?? null,
    currency: details.currency ?? null,
    exchange: details.exchange ?? null,
    countryOfRisk: details.countryOfRiskName ?? details.countryOfRisk ?? null,
    lastPrice: lastPrice?.price ? quotationToNumber(lastPrice.price) : null,
    tradingStatus: statusEnum,
    tradingStatusText: statusEnum ? TRADING_STATUS_LABELS[statusEnum] ?? statusEnum : null,
    apiTradeAvailable: status.apiTradeAvailableFlag ?? details.apiTradeAvailableFlag ?? null,
    forQualInvestor: details.forQualInvestorFlag ?? null,
    futuresMargin: futuresMargin
      ? {
          initialMarginOnBuy: futuresMargin.initialMarginOnBuy
            ? moneyToNumber(futuresMargin.initialMarginOnBuy)
            : null,
          initialMarginOnSell: futuresMargin.initialMarginOnSell
            ? moneyToNumber(futuresMargin.initialMarginOnSell)
            : null,
          minPriceIncrement: futuresMargin.minPriceIncrement
            ? quotationToNumber(futuresMargin.minPriceIncrement)
            : null,
          minPriceIncrementAmount: futuresMargin.minPriceIncrementAmount
            ? quotationToNumber(futuresMargin.minPriceIncrementAmount)
            : null,
        }
      : null,
  };
}

export async function fetchInstrumentCard(
  api: InstrumentCardApi,
  query: string,
): Promise<InstrumentCardView> {
  const found = await resolveInstrument(api, query);
  const { instrument } = await api.getInstrumentByUid(found.uid);
  const [prices, status] = await Promise.all([
    api.getLastPrices([found.uid]),
    api.getTradingStatus(found.uid),
  ]);
  // Гарантийное обеспечение имеет смысл только для фьючерсов.
  const futuresMargin =
    instrument.instrumentType === 'futures' ? await api.getFuturesMargin(found.uid) : null;
  return buildInstrumentCard({
    details: instrument,
    lastPrice: prices.lastPrices.find((p) => p.instrumentUid === found.uid) ?? prices.lastPrices[0],
    status,
    futuresMargin,
  });
}

export function renderInstrumentCard(view: InstrumentCardView): string {
  const dash = '—';
  const lines = [
    `${view.ticker ?? dash} — ${view.name}`,
    `Тип: ${view.instrumentType ?? dash} | ISIN: ${view.isin ?? dash} | Биржа: ${view.exchange ?? dash}`,
    `Страна риска: ${view.countryOfRisk ?? dash} | Валюта: ${view.currency?.toUpperCase() ?? dash} | Лот: ${view.lot ?? dash}`,
    `Последняя цена: ${view.lastPrice !== null ? formatAmount(view.lastPrice) : dash}`,
    `Статус торгов: ${view.tradingStatusText ?? dash}`,
    `Доступен через API: ${view.apiTradeAvailable === null ? dash : view.apiTradeAvailable ? 'да' : 'нет'}` +
      (view.forQualInvestor ? ' | только для квалифицированных инвесторов' : ''),
  ];
  if (view.futuresMargin) {
    const m = view.futuresMargin;
    lines.push(
      `ГО покупка/продажа: ${m.initialMarginOnBuy !== null ? formatAmount(m.initialMarginOnBuy) : dash} / ${m.initialMarginOnSell !== null ? formatAmount(m.initialMarginOnSell) : dash}`,
      `Шаг цены: ${m.minPriceIncrement ?? dash} (стоимость шага: ${m.minPriceIncrementAmount !== null ? formatAmount(m.minPriceIncrementAmount) : dash})`,
    );
  }
  return lines.join('\n');
}
