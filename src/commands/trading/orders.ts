/**
 * Торговые заявки: выставление, предпросмотр, список, статус, отмена, замена.
 * Работает в песочнице (SandboxService) и на боевом счёте (OrdersService);
 * предохранители — см. trading/paths.ts.
 *
 * Экспорты:
 * - TradingApi — контракт клиента (низкоуровневый call + счета + поиск);
 * - ORDER_STATUS_LABELS — русские подписи статусов исполнения;
 * - resolveTradeInstrument(api, query) — резолв с проверкой торгуемости;
 * - placeOrder(api, params) — выставить рыночную/лимитную заявку;
 * - previewOrder(api, params) — оценка стоимости и доступных лотов (чтение);
 * - listOrders / orderStatus / cancelOrder / replaceOrder;
 * - renderPlacedOrder / renderOrderPreview / renderOrders / renderOrderState.
 */
import { randomUUID } from 'node:crypto';
import { AppError } from '../../api/errors.js';
import {
  formatAmount,
  moneyToNumber,
  numberToQuotation,
  quotationToNumber,
} from '../../api/money.js';
import type { GetLastPricesResponse } from '../../api/types.js';
import type {
  CancelOrderResponse,
  GetMaxLotsResponse,
  GetOrderPriceResponse,
  GetOrdersResponse,
  OrderState,
  PostOrderRequest,
  PostOrderResponse,
} from '../../api/types-trading.js';
import type { TInvestMode } from '../../config/config.js';
import { renderTable } from '../../format/table.js';
import { resolveAccountId, type AccountsApi } from '../resolve-account.js';
import { resolveInstrument, type InstrumentSearchApi } from '../resolve-instrument.js';
import { assertMutationAllowed, tradingPathsForMode } from './paths.js';

export interface TradingApi extends AccountsApi, InstrumentSearchApi {
  call<T>(methodPath: string, body: unknown): Promise<T>;
  getLastPrices(instrumentIds: string[]): Promise<GetLastPricesResponse>;
}

export type TradeDirection = 'buy' | 'sell';

// Русские подписи статусов исполнения торгового поручения.
export const ORDER_STATUS_LABELS: Record<string, string> = {
  EXECUTION_REPORT_STATUS_FILL: 'исполнена',
  EXECUTION_REPORT_STATUS_PARTIALLYFILL: 'исполнена частично',
  EXECUTION_REPORT_STATUS_NEW: 'выставлена',
  EXECUTION_REPORT_STATUS_REJECTED: 'отклонена',
  EXECUTION_REPORT_STATUS_CANCELLED: 'отменена',
};

export interface PlacedOrderView {
  orderId: string | null;
  clientOrderId: string; // ключ идемпотентности, который отправили мы
  ticker: string;
  direction: TradeDirection;
  orderType: 'market' | 'limit';
  statusText: string | null;
  lotsRequested: number | null;
  lotsExecuted: number | null;
  totalAmount: number | null;
  executedPrice: number | null;
  commission: number | null;
  currency: string | null;
  message: string | null; // причина отклонения (если есть)
}

function orderStatusText(status: string | undefined): string | null {
  if (!status) {
    return null;
  }
  return ORDER_STATUS_LABELS[status] ?? status;
}

// Резолв инструмента для торговли: бумага обязана торговаться через API.
export async function resolveTradeInstrument(api: TradingApi, query: string) {
  const instrument = await resolveInstrument(api, query);
  if (instrument.apiTradeAvailableFlag === false) {
    throw new AppError({
      code: 'APP_TINVEST_NOT_TRADABLE',
      userMessage: `«${instrument.ticker}» (${instrument.name}) недоступен для торговли через API.`,
    });
  }
  return instrument;
}

function toPlacedView(
  resp: PostOrderResponse,
  base: { ticker: string; direction: TradeDirection; orderType: 'market' | 'limit'; clientOrderId: string },
): PlacedOrderView {
  return {
    orderId: resp.orderId ?? null,
    clientOrderId: base.clientOrderId,
    ticker: base.ticker,
    direction: base.direction,
    orderType: base.orderType,
    statusText: orderStatusText(resp.executionReportStatus),
    lotsRequested: resp.lotsRequested ? Number(resp.lotsRequested) : null,
    lotsExecuted: resp.lotsExecuted ? Number(resp.lotsExecuted) : null,
    totalAmount: resp.totalOrderAmount ? moneyToNumber(resp.totalOrderAmount) : null,
    executedPrice: resp.executedOrderPrice ? moneyToNumber(resp.executedOrderPrice) : null,
    commission: resp.executedCommission ? moneyToNumber(resp.executedCommission) : null,
    currency: resp.totalOrderAmount?.currency ?? null,
    message: resp.message || null,
  };
}

export async function placeOrder(
  api: TradingApi,
  params: {
    mode: TInvestMode;
    explicitAccountId?: string;
    query: string;
    lots: number;
    direction: TradeDirection;
    limitPrice: number | null; // null — рыночная заявка
    orderId?: string; // свой ключ идемпотентности (для повтора)
    confirm: boolean;
  },
): Promise<PlacedOrderView> {
  // Предохранитель ДО любых сетевых вызовов.
  assertMutationAllowed(params.mode, params.confirm);
  const paths = tradingPathsForMode(params.mode);
  const accountId = await resolveAccountId(api, params.explicitAccountId);
  const instrument = await resolveTradeInstrument(api, params.query);

  const clientOrderId = params.orderId ?? randomUUID();
  const orderType = params.limitPrice !== null ? 'limit' : 'market';
  const request: PostOrderRequest = {
    accountId,
    instrumentId: instrument.uid,
    quantity: String(params.lots),
    direction: params.direction === 'buy' ? 'ORDER_DIRECTION_BUY' : 'ORDER_DIRECTION_SELL',
    orderType: orderType === 'limit' ? 'ORDER_TYPE_LIMIT' : 'ORDER_TYPE_MARKET',
    orderId: clientOrderId,
    ...(params.limitPrice !== null ? { price: numberToQuotation(params.limitPrice) } : {}),
  };
  const resp = await api.call<PostOrderResponse>(paths.postOrder, request);
  return toPlacedView(resp, { ticker: instrument.ticker, direction: params.direction, orderType, clientOrderId });
}

export interface OrderPreviewView {
  ticker: string;
  name: string;
  lotSize: number | null;
  direction: TradeDirection;
  lots: number;
  priceUsed: number | null; // лимитная цена или последняя рыночная
  priceSource: 'limit' | 'last-price';
  estimatedAmount: number | null;
  commission: number | null;
  currency: string | null;
  maxBuyLots: number | null;
  maxSellLots: number | null;
  availableMoney: number | null;
}

export async function previewOrder(
  api: TradingApi,
  params: {
    mode: TInvestMode;
    explicitAccountId?: string;
    query: string;
    lots: number;
    direction: TradeDirection;
    limitPrice: number | null;
  },
): Promise<OrderPreviewView> {
  // Предпросмотр — чтение: доступен во всех режимах, включая readonly.
  const paths = tradingPathsForMode(params.mode);
  const accountId = await resolveAccountId(api, params.explicitAccountId);
  const instrument = await resolveTradeInstrument(api, params.query);

  // Цена для оценки: лимитная, иначе последняя рыночная (честно помечаем источник).
  let priceUsed = params.limitPrice;
  let priceSource: 'limit' | 'last-price' = 'limit';
  if (priceUsed === null) {
    const { lastPrices } = await api.getLastPrices([instrument.uid]);
    const last = lastPrices.find((p) => p.instrumentUid === instrument.uid)?.price;
    priceUsed = last ? quotationToNumber(last) : null;
    priceSource = 'last-price';
  }

  const maxLots = await api.call<GetMaxLotsResponse>(paths.getMaxLots, {
    accountId,
    instrumentId: instrument.uid,
    ...(priceUsed !== null ? { price: numberToQuotation(priceUsed) } : {}),
  });

  // Оценка стоимости через GetOrderPrice возможна только при известной цене.
  let estimatedAmount: number | null = null;
  let commission: number | null = null;
  let currency: string | null = maxLots.currency ?? null;
  if (priceUsed !== null) {
    const price = await api.call<GetOrderPriceResponse>(paths.getOrderPrice, {
      accountId,
      instrumentId: instrument.uid,
      price: numberToQuotation(priceUsed),
      direction: params.direction === 'buy' ? 'ORDER_DIRECTION_BUY' : 'ORDER_DIRECTION_SELL',
      quantity: String(params.lots),
    });
    estimatedAmount = price.totalOrderAmount ? moneyToNumber(price.totalOrderAmount) : null;
    commission = price.executedCommission ? moneyToNumber(price.executedCommission) : null;
    currency = price.totalOrderAmount?.currency ?? currency;
  }

  return {
    ticker: instrument.ticker,
    name: instrument.name,
    lotSize: instrument.lot ?? null,
    direction: params.direction,
    lots: params.lots,
    priceUsed,
    priceSource,
    estimatedAmount,
    commission,
    currency,
    maxBuyLots: maxLots.buyLimits?.buyMaxLots ? Number(maxLots.buyLimits.buyMaxLots) : null,
    maxSellLots: maxLots.sellLimits?.sellMaxLots ? Number(maxLots.sellLimits.sellMaxLots) : null,
    availableMoney: maxLots.buyLimits?.buyMoneyAmount
      ? quotationToNumber(maxLots.buyLimits.buyMoneyAmount)
      : null,
  };
}

export interface OrderStateView {
  orderId: string | null;
  ticker: string | null;
  direction: TradeDirection | null;
  statusText: string | null;
  lotsRequested: number | null;
  lotsExecuted: number | null;
  initialPrice: number | null;
  totalAmount: number | null;
  currency: string | null;
  orderDate: string | null;
}

export function toOrderStateView(order: OrderState): OrderStateView {
  return {
    orderId: order.orderId ?? null,
    ticker: order.ticker ?? order.figi ?? null,
    direction:
      order.direction === 'ORDER_DIRECTION_BUY'
        ? 'buy'
        : order.direction === 'ORDER_DIRECTION_SELL'
          ? 'sell'
          : null,
    statusText: orderStatusText(order.executionReportStatus),
    lotsRequested: order.lotsRequested ? Number(order.lotsRequested) : null,
    lotsExecuted: order.lotsExecuted ? Number(order.lotsExecuted) : null,
    initialPrice: order.initialSecurityPrice ? moneyToNumber(order.initialSecurityPrice) : null,
    totalAmount: order.totalOrderAmount ? moneyToNumber(order.totalOrderAmount) : null,
    currency: order.totalOrderAmount?.currency ?? null,
    orderDate: order.orderDate ?? null,
  };
}

export async function listOrders(
  api: TradingApi,
  params: { mode: TInvestMode; explicitAccountId?: string },
): Promise<OrderStateView[]> {
  const paths = tradingPathsForMode(params.mode);
  const accountId = await resolveAccountId(api, params.explicitAccountId);
  const resp = await api.call<GetOrdersResponse>(paths.getOrders, { accountId });
  return (resp.orders ?? []).map(toOrderStateView);
}

export async function orderStatus(
  api: TradingApi,
  params: { mode: TInvestMode; explicitAccountId?: string; orderId: string },
): Promise<OrderStateView> {
  const paths = tradingPathsForMode(params.mode);
  const accountId = await resolveAccountId(api, params.explicitAccountId);
  const resp = await api.call<OrderState>(paths.getOrderState, {
    accountId,
    orderId: params.orderId,
  });
  return toOrderStateView(resp);
}

export async function cancelOrder(
  api: TradingApi,
  params: { mode: TInvestMode; explicitAccountId?: string; orderId: string; confirm: boolean },
): Promise<{ cancelledAt: string | null }> {
  assertMutationAllowed(params.mode, params.confirm);
  const paths = tradingPathsForMode(params.mode);
  const accountId = await resolveAccountId(api, params.explicitAccountId);
  const resp = await api.call<CancelOrderResponse>(paths.cancelOrder, {
    accountId,
    orderId: params.orderId,
  });
  return { cancelledAt: resp.time ?? null };
}

export async function replaceOrder(
  api: TradingApi,
  params: {
    mode: TInvestMode;
    explicitAccountId?: string;
    orderId: string;
    lots: number;
    price: number;
    confirm: boolean;
  },
): Promise<PlacedOrderView> {
  assertMutationAllowed(params.mode, params.confirm);
  const paths = tradingPathsForMode(params.mode);
  const accountId = await resolveAccountId(api, params.explicitAccountId);
  const idempotencyKey = randomUUID();
  const resp = await api.call<PostOrderResponse>(paths.replaceOrder, {
    accountId,
    orderId: params.orderId,
    idempotencyKey,
    quantity: String(params.lots),
    price: numberToQuotation(params.price),
  });
  return toPlacedView(resp, {
    ticker: resp.figi ?? params.orderId,
    direction: resp.direction === 'ORDER_DIRECTION_SELL' ? 'sell' : 'buy',
    orderType: 'limit',
    clientOrderId: idempotencyKey,
  });
}

// --- Рендеры ---

const dash = '—';

export function renderPlacedOrder(view: PlacedOrderView): string {
  const lines = [
    `Заявка ${view.direction === 'buy' ? 'на покупку' : 'на продажу'} ${view.ticker} (${view.orderType === 'limit' ? 'лимитная' : 'рыночная'}): ${view.statusText ?? dash}`,
    `Номер: ${view.orderId ?? dash} | лотов: ${view.lotsExecuted ?? 0}/${view.lotsRequested ?? dash}`,
    `Сумма: ${view.totalAmount !== null ? `${formatAmount(view.totalAmount)} ${view.currency?.toUpperCase() ?? ''}` : dash}` +
      (view.commission !== null ? ` | комиссия: ${formatAmount(view.commission)}` : ''),
  ];
  if (view.message) {
    lines.push(`Сообщение брокера: ${view.message}`);
  }
  return lines.join('\n');
}

export function renderOrderPreview(view: OrderPreviewView): string {
  return [
    `Предпросмотр: ${view.direction === 'buy' ? 'покупка' : 'продажа'} ${view.ticker} (${view.name}), лотов: ${view.lots}` +
      (view.lotSize !== null ? ` (в лоте ${view.lotSize} шт.)` : ''),
    `Цена для оценки: ${view.priceUsed !== null ? formatAmount(view.priceUsed) : dash} (${view.priceSource === 'limit' ? 'лимитная' : 'последняя рыночная'})`,
    `Оценка суммы: ${view.estimatedAmount !== null ? `${formatAmount(view.estimatedAmount)} ${view.currency?.toUpperCase() ?? ''}` : dash}` +
      (view.commission !== null ? ` | комиссия: ${formatAmount(view.commission)}` : ''),
    `Доступно: покупка до ${view.maxBuyLots ?? dash} лотов | продажа до ${view.maxSellLots ?? dash} лотов` +
      (view.availableMoney !== null ? ` | свободно ${formatAmount(view.availableMoney)}` : ''),
  ].join('\n');
}

export function renderOrders(views: OrderStateView[]): string {
  if (views.length === 0) {
    return 'Активных заявок нет.';
  }
  return renderTable(
    ['Номер', 'Тикер', 'Напр.', 'Статус', 'Лоты', 'Цена', 'Сумма'],
    views.map((v) => [
      v.orderId ?? dash,
      v.ticker ?? dash,
      v.direction === 'buy' ? 'покупка' : v.direction === 'sell' ? 'продажа' : dash,
      v.statusText ?? dash,
      `${v.lotsExecuted ?? 0}/${v.lotsRequested ?? dash}`,
      v.initialPrice !== null ? formatAmount(v.initialPrice) : dash,
      v.totalAmount !== null ? formatAmount(v.totalAmount) : dash,
    ]),
  );
}

export function renderOrderState(view: OrderStateView): string {
  return [
    `Заявка ${view.orderId ?? dash}: ${view.statusText ?? dash}`,
    `${view.ticker ?? dash} | ${view.direction === 'buy' ? 'покупка' : view.direction === 'sell' ? 'продажа' : dash} | лотов ${view.lotsExecuted ?? 0}/${view.lotsRequested ?? dash}`,
    `Цена: ${view.initialPrice !== null ? formatAmount(view.initialPrice) : dash} | сумма: ${view.totalAmount !== null ? formatAmount(view.totalAmount) : dash}`,
  ].join('\n');
}
