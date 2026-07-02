/**
 * Стоп-заявки: тейк-профит, стоп-лосс, стоп-лимит (песочница и full;
 * предохранители — trading/paths.ts).
 *
 * Экспорты:
 * - StopOrderKind — человекочитаемые типы стоп-заявок CLI;
 * - placeStopOrder(api, params) — выставить стоп-заявку;
 * - listStopOrders(api, params) — активные стоп-заявки;
 * - cancelStopOrder(api, params) — отменить стоп-заявку;
 * - renderPlacedStopOrder / renderStopOrders — вывод.
 */
import { randomUUID } from 'node:crypto';
import { AppError } from '../../api/errors.js';
import { formatAmount, moneyToNumber, numberToQuotation } from '../../api/money.js';
import type {
  CancelStopOrderResponse,
  GetStopOrdersResponse,
  PostStopOrderRequest,
  PostStopOrderResponse,
  StopOrderInfo,
  StopOrderType,
} from '../../api/types-trading.js';
import type { TInvestMode } from '../../config/config.js';
import { renderTable } from '../../format/table.js';
import { resolveAccountId } from '../resolve-account.js';
import { assertMutationAllowed, tradingPathsForMode } from './paths.js';
import { resolveTradeInstrument, type TradeDirection, type TradingApi } from './orders.js';

export type StopOrderKind = 'take-profit' | 'stop-loss' | 'stop-limit';

const STOP_TYPE_BY_KIND: Record<StopOrderKind, StopOrderType> = {
  'take-profit': 'STOP_ORDER_TYPE_TAKE_PROFIT',
  'stop-loss': 'STOP_ORDER_TYPE_STOP_LOSS',
  'stop-limit': 'STOP_ORDER_TYPE_STOP_LIMIT',
};

export interface PlacedStopOrderView {
  stopOrderId: string | null;
  ticker: string;
  kind: StopOrderKind;
  direction: TradeDirection;
  lots: number;
  stopPrice: number;
  limitPrice: number | null;
}

export async function placeStopOrder(
  api: TradingApi,
  params: {
    mode: TInvestMode;
    explicitAccountId?: string;
    query: string;
    lots: number;
    kind: StopOrderKind;
    direction: TradeDirection;
    stopPrice: number;
    limitPrice: number | null;
    confirm: boolean;
  },
): Promise<PlacedStopOrderView> {
  assertMutationAllowed(params.mode, params.confirm);
  // Стоп-лимит без лимитной цены не имеет смысла — явная ошибка до API.
  if (params.kind === 'stop-limit' && params.limitPrice === null) {
    throw new AppError({
      code: 'APP_CLI_INVALID_ARGUMENT',
      userMessage: 'Для стоп-лимита укажите лимитную цену: --price <цена>.',
    });
  }
  const paths = tradingPathsForMode(params.mode);
  const accountId = await resolveAccountId(api, params.explicitAccountId);
  const instrument = await resolveTradeInstrument(api, params.query);

  const request: PostStopOrderRequest = {
    accountId,
    instrumentId: instrument.uid,
    quantity: String(params.lots),
    direction: params.direction === 'buy' ? 'STOP_ORDER_DIRECTION_BUY' : 'STOP_ORDER_DIRECTION_SELL',
    stopOrderType: STOP_TYPE_BY_KIND[params.kind],
    expirationType: 'STOP_ORDER_EXPIRATION_TYPE_GOOD_TILL_CANCEL',
    stopPrice: numberToQuotation(params.stopPrice),
    ...(params.limitPrice !== null ? { price: numberToQuotation(params.limitPrice) } : {}),
    orderId: randomUUID(),
  };
  const resp = await api.call<PostStopOrderResponse>(paths.postStopOrder, request);
  return {
    stopOrderId: resp.stopOrderId ?? null,
    ticker: instrument.ticker,
    kind: params.kind,
    direction: params.direction,
    lots: params.lots,
    stopPrice: params.stopPrice,
    limitPrice: params.limitPrice,
  };
}

export interface StopOrderView {
  stopOrderId: string | null;
  ticker: string | null; // figi, если тикера нет в ответе
  direction: TradeDirection | null;
  lots: number | null;
  stopPrice: number | null;
  limitPrice: number | null;
  createDate: string | null;
  status: string | null;
}

export function toStopOrderView(info: StopOrderInfo): StopOrderView {
  return {
    stopOrderId: info.stopOrderId ?? null,
    ticker: info.figi ?? info.instrumentUid ?? null,
    direction:
      info.direction === 'STOP_ORDER_DIRECTION_BUY'
        ? 'buy'
        : info.direction === 'STOP_ORDER_DIRECTION_SELL'
          ? 'sell'
          : null,
    lots: info.lotsRequested ? Number(info.lotsRequested) : null,
    stopPrice: info.stopPrice ? moneyToNumber(info.stopPrice) : null,
    limitPrice: info.price && moneyToNumber(info.price) !== 0 ? moneyToNumber(info.price) : null,
    createDate: info.createDate ?? null,
    status: info.status ?? null,
  };
}

export async function listStopOrders(
  api: TradingApi,
  params: { mode: TInvestMode; explicitAccountId?: string },
): Promise<StopOrderView[]> {
  const paths = tradingPathsForMode(params.mode);
  const accountId = await resolveAccountId(api, params.explicitAccountId);
  const resp = await api.call<GetStopOrdersResponse>(paths.getStopOrders, { accountId });
  return (resp.stopOrders ?? []).map(toStopOrderView);
}

export async function cancelStopOrder(
  api: TradingApi,
  params: { mode: TInvestMode; explicitAccountId?: string; stopOrderId: string; confirm: boolean },
): Promise<{ cancelledAt: string | null }> {
  assertMutationAllowed(params.mode, params.confirm);
  const paths = tradingPathsForMode(params.mode);
  const accountId = await resolveAccountId(api, params.explicitAccountId);
  const resp = await api.call<CancelStopOrderResponse>(paths.cancelStopOrder, {
    accountId,
    stopOrderId: params.stopOrderId,
  });
  return { cancelledAt: resp.time ?? null };
}

const dash = '—';

export function renderPlacedStopOrder(view: PlacedStopOrderView): string {
  const kindLabels: Record<StopOrderKind, string> = {
    'take-profit': 'тейк-профит',
    'stop-loss': 'стоп-лосс',
    'stop-limit': 'стоп-лимит',
  };
  return [
    `Стоп-заявка (${kindLabels[view.kind]}) по ${view.ticker} выставлена: ${view.stopOrderId ?? dash}`,
    `${view.direction === 'buy' ? 'Покупка' : 'Продажа'} ${view.lots} лот(ов) при цене ${formatAmount(view.stopPrice)}` +
      (view.limitPrice !== null ? `, лимит ${formatAmount(view.limitPrice)}` : ''),
  ].join('\n');
}

export function renderStopOrders(views: StopOrderView[]): string {
  if (views.length === 0) {
    return 'Активных стоп-заявок нет.';
  }
  return renderTable(
    ['Номер', 'Бумага', 'Напр.', 'Лоты', 'Стоп-цена', 'Лимит', 'Создана'],
    views.map((v) => [
      v.stopOrderId ?? dash,
      v.ticker ?? dash,
      v.direction === 'buy' ? 'покупка' : v.direction === 'sell' ? 'продажа' : dash,
      v.lots !== null ? String(v.lots) : dash,
      v.stopPrice !== null ? formatAmount(v.stopPrice) : dash,
      v.limitPrice !== null ? formatAmount(v.limitPrice) : dash,
      v.createDate?.slice(0, 10) ?? dash,
    ]),
  );
}
