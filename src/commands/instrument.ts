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
import { moneyToNumberOrNull, quotationToNumberOrNull } from '../api/money.js';
import type {
  GetInstrumentByResponse,
  GetLastPricesResponse,
  InstrumentDetails,
  LastPrice,
} from '../api/types.js';
import type { GetFuturesMarginResponse, GetTradingStatusResponse } from '../api/types-market.js';
import { DASH, moneyOrDash } from '../format/values.js';
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
    // Опущенные protobuf-JSON message-поля → null (цена без торгов и т.п.).
    lastPrice: quotationToNumberOrNull(lastPrice?.price),
    tradingStatus: statusEnum,
    tradingStatusText: statusEnum ? TRADING_STATUS_LABELS[statusEnum] ?? statusEnum : null,
    apiTradeAvailable: status.apiTradeAvailableFlag ?? details.apiTradeAvailableFlag ?? null,
    forQualInvestor: details.forQualInvestorFlag ?? null,
    futuresMargin: futuresMargin
      ? {
          initialMarginOnBuy: moneyToNumberOrNull(futuresMargin.initialMarginOnBuy),
          initialMarginOnSell: moneyToNumberOrNull(futuresMargin.initialMarginOnSell),
          minPriceIncrement: quotationToNumberOrNull(futuresMargin.minPriceIncrement),
          minPriceIncrementAmount: quotationToNumberOrNull(futuresMargin.minPriceIncrementAmount),
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
  const lines = [
    `${view.ticker ?? DASH} — ${view.name}`,
    `Тип: ${view.instrumentType ?? DASH} | ISIN: ${view.isin ?? DASH} | Биржа: ${view.exchange ?? DASH}`,
    `Страна риска: ${view.countryOfRisk ?? DASH} | Валюта: ${view.currency?.toUpperCase() ?? DASH} | Лот: ${view.lot ?? DASH}`,
    `Последняя цена: ${moneyOrDash(view.lastPrice)}`,
    `Статус торгов: ${view.tradingStatusText ?? DASH}`,
    `Доступен через API: ${view.apiTradeAvailable === null ? DASH : view.apiTradeAvailable ? 'да' : 'нет'}` +
      (view.forQualInvestor ? ' | только для квалифицированных инвесторов' : ''),
  ];
  if (view.futuresMargin) {
    const m = view.futuresMargin;
    lines.push(
      `ГО покупка/продажа: ${moneyOrDash(m.initialMarginOnBuy)} / ${moneyOrDash(m.initialMarginOnSell)}`,
      // Шаг цены печатаем как есть (не через toFixed): дробность шага
      // произвольна (0.01, 0.0001…) и не должна усекаться до 2 знаков.
      `Шаг цены: ${m.minPriceIncrement ?? DASH} (стоимость шага: ${moneyOrDash(m.minPriceIncrementAmount)})`,
    );
  }
  return lines.join('\n');
}
