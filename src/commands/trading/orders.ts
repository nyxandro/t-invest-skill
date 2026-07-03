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
  moneyToNumberOrNull,
  numberToQuotation,
  quotationToNumberOrNull,
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
import type { SessionLock } from '../../config/session.js';
import { renderTable } from '../../format/table.js';
import { DASH } from '../../format/values.js';
import {
  directionFromApi,
  directionLabel,
  directionPhrase,
  orderDirectionToApi,
  type TradeDirection,
} from '../../format/direction.js';
import { resolveAccountId, type AccountsApi } from '../resolve-account.js';
import { resolveInstrument, type InstrumentSearchApi } from '../resolve-instrument.js';
import { assertMutationAllowed, tradingPathsForMode } from './paths.js';

export interface TradingApi extends AccountsApi, InstrumentSearchApi {
  call<T>(methodPath: string, body: unknown): Promise<T>;
  getLastPrices(instrumentIds: string[]): Promise<GetLastPricesResponse>;
}

// Реэкспорт для торговых модулей и регистрации команд (единый тип направления).
export type { TradeDirection } from '../../format/direction.js';

// Печать ключа идемпотентности в stderr ДО отправки мутации: при обрыве связи
// или таймауте ключ не теряется вместе с процессом — его можно передать в
// повтор через --order-id и не задвоить реальную заявку.
function announceIdempotencyKey(clientOrderId: string): void {
  console.error(
    `Ключ идемпотентности заявки: ${clientOrderId}. ` +
      `Для безопасного повтора той же заявки используйте: --order-id ${clientOrderId}`,
  );
}

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
  direction: TradeDirection | null; // null, если ответ не сообщил направление
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

// Резолв инструмента для торговли: бумага обязана торговаться через API, и
// запрос обязан однозначно указывать на один инструмент. requireUnambiguous
// не даёт молча выбрать «первую» бумагу, когда тикер совпал у РАЗНЫХ выпусков
// на разных площадках — иначе можно купить не то реальными деньгами.
export async function resolveTradeInstrument(api: TradingApi, query: string) {
  const instrument = await resolveInstrument(api, query, { requireUnambiguous: true });
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
  base: {
    ticker: string;
    direction: TradeDirection | null;
    orderType: 'market' | 'limit';
    clientOrderId: string;
  },
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
    totalAmount: moneyToNumberOrNull(resp.totalOrderAmount),
    executedPrice: moneyToNumberOrNull(resp.executedOrderPrice),
    commission: moneyToNumberOrNull(resp.executedCommission),
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
    sessionLock: SessionLock | null;
  },
): Promise<PlacedOrderView> {
  // Предохранитель ДО любых сетевых вызовов (в full — требует full-сессию).
  assertMutationAllowed(params.mode, params.confirm, params.sessionLock);
  const paths = tradingPathsForMode(params.mode);
  // Резолвы счёта и инструмента независимы — параллелим (экономия round-trip).
  const [accountId, instrument] = await Promise.all([
    resolveAccountId(api, params.explicitAccountId),
    resolveTradeInstrument(api, params.query),
  ]);

  const clientOrderId = params.orderId ?? randomUUID();
  const orderType = params.limitPrice !== null ? 'limit' : 'market';
  const request: PostOrderRequest = {
    accountId,
    instrumentId: instrument.uid,
    quantity: String(params.lots),
    direction: orderDirectionToApi(params.direction),
    orderType: orderType === 'limit' ? 'ORDER_TYPE_LIMIT' : 'ORDER_TYPE_MARKET',
    orderId: clientOrderId,
    ...(params.limitPrice !== null ? { price: numberToQuotation(params.limitPrice) } : {}),
  };
  announceIdempotencyKey(clientOrderId);
  const resp = await api.call<PostOrderResponse>(paths.postOrder, request);
  // Направление известно из запроса пользователя — берём его, а не из ответа.
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
  // Резолвы счёта и инструмента независимы — параллелим.
  const [accountId, instrument] = await Promise.all([
    resolveAccountId(api, params.explicitAccountId),
    resolveTradeInstrument(api, params.query),
  ]);

  // Цена для оценки: лимитная, иначе последняя рыночная (честно помечаем источник).
  let priceUsed = params.limitPrice;
  let priceSource: 'limit' | 'last-price' = 'limit';
  if (priceUsed === null) {
    const { lastPrices } = await api.getLastPrices([instrument.uid]);
    // Ловушка API: у бумаги без торгов запись приходит БЕЗ поля price —
    // нормализуем через *OrNull (0 остался бы «настоящей» ценой при `?.price`).
    const last = lastPrices.find((p) => p.instrumentUid === instrument.uid)?.price;
    priceUsed = quotationToNumberOrNull(last);
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
      direction: orderDirectionToApi(params.direction),
      quantity: String(params.lots),
    });
    estimatedAmount = moneyToNumberOrNull(price.totalOrderAmount);
    commission = moneyToNumberOrNull(price.executedCommission);
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
    availableMoney: quotationToNumberOrNull(maxLots.buyLimits?.buyMoneyAmount),
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
    direction: directionFromApi(order.direction),
    statusText: orderStatusText(order.executionReportStatus),
    lotsRequested: order.lotsRequested ? Number(order.lotsRequested) : null,
    lotsExecuted: order.lotsExecuted ? Number(order.lotsExecuted) : null,
    initialPrice: moneyToNumberOrNull(order.initialSecurityPrice),
    totalAmount: moneyToNumberOrNull(order.totalOrderAmount),
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
  params: {
    mode: TInvestMode;
    explicitAccountId?: string;
    orderId: string;
    confirm: boolean;
    sessionLock: SessionLock | null;
  },
): Promise<{ cancelledAt: string | null }> {
  assertMutationAllowed(params.mode, params.confirm, params.sessionLock);
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
    newOrderId?: string; // свой ключ идемпотентности для повтора замены
    confirm: boolean;
    sessionLock: SessionLock | null;
  },
): Promise<PlacedOrderView> {
  assertMutationAllowed(params.mode, params.confirm, params.sessionLock);
  const paths = tradingPathsForMode(params.mode);
  const accountId = await resolveAccountId(api, params.explicitAccountId);
  // Ключ идемпотентности замены: свой (для безопасного повтора при таймауте)
  // или сгенерированный. Раньше он всегда был случайным — повтор замены
  // отправлял новый ключ, и API не мог сопоставить его с первым запросом.
  const idempotencyKey = params.newOrderId ?? randomUUID();
  announceIdempotencyKey(idempotencyKey);
  const resp = await api.call<PostOrderResponse>(paths.replaceOrder, {
    accountId,
    orderId: params.orderId,
    idempotencyKey,
    quantity: String(params.lots),
    price: numberToQuotation(params.price),
  });
  return toPlacedView(resp, {
    ticker: resp.figi ?? params.orderId,
    // Направление берём из ответа; при отсутствии поля — null, не «покупка».
    direction: directionFromApi(resp.direction),
    orderType: 'limit',
    clientOrderId: idempotencyKey,
  });
}

// --- Рендеры ---

// Заголовок заявки: направление может быть неизвестно (null) — тогда фразу о
// направлении опускаем, а не подставляем «покупку».
function placedHeaderDirection(direction: TradeDirection | null): string {
  return direction ? `${directionPhrase(direction)} ` : '';
}

export function renderPlacedOrder(view: PlacedOrderView): string {
  const lines = [
    `Заявка ${placedHeaderDirection(view.direction)}${view.ticker} (${view.orderType === 'limit' ? 'лимитная' : 'рыночная'}): ${view.statusText ?? DASH}`,
    `Номер: ${view.orderId ?? DASH} | ключ идемпотентности: ${view.clientOrderId} | лотов: ${view.lotsExecuted ?? 0}/${view.lotsRequested ?? DASH}`,
    `Сумма: ${view.totalAmount !== null ? `${formatAmount(view.totalAmount)} ${view.currency?.toUpperCase() ?? ''}` : DASH}` +
      (view.commission !== null ? ` | комиссия: ${formatAmount(view.commission)}` : ''),
  ];
  if (view.message) {
    lines.push(`Сообщение брокера: ${view.message}`);
  }
  return lines.join('\n');
}

export function renderOrderPreview(view: OrderPreviewView): string {
  return [
    `Предпросмотр: ${directionLabel(view.direction)} ${view.ticker} (${view.name}), лотов: ${view.lots}` +
      (view.lotSize !== null ? ` (в лоте ${view.lotSize} шт.)` : ''),
    `Цена для оценки: ${view.priceUsed !== null ? formatAmount(view.priceUsed) : DASH} (${view.priceSource === 'limit' ? 'лимитная' : 'последняя рыночная'})`,
    `Оценка суммы: ${view.estimatedAmount !== null ? `${formatAmount(view.estimatedAmount)} ${view.currency?.toUpperCase() ?? ''}` : DASH}` +
      (view.commission !== null ? ` | комиссия: ${formatAmount(view.commission)}` : ''),
    `Доступно: покупка до ${view.maxBuyLots ?? DASH} лотов | продажа до ${view.maxSellLots ?? DASH} лотов` +
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
      v.orderId ?? DASH,
      v.ticker ?? DASH,
      directionLabel(v.direction),
      v.statusText ?? DASH,
      `${v.lotsExecuted ?? 0}/${v.lotsRequested ?? DASH}`,
      v.initialPrice !== null ? formatAmount(v.initialPrice) : DASH,
      v.totalAmount !== null ? formatAmount(v.totalAmount) : DASH,
    ]),
  );
}

export function renderOrderState(view: OrderStateView): string {
  return [
    `Заявка ${view.orderId ?? DASH}: ${view.statusText ?? DASH}`,
    `${view.ticker ?? DASH} | ${directionLabel(view.direction)} | лотов ${view.lotsExecuted ?? 0}/${view.lotsRequested ?? DASH}`,
    `Цена: ${view.initialPrice !== null ? formatAmount(view.initialPrice) : DASH} | сумма: ${view.totalAmount !== null ? formatAmount(view.totalAmount) : DASH}`,
  ].join('\n');
}
