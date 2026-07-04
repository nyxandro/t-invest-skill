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
 * - PlacedOrderView / OrderPreviewView / OrderStateView — типы представлений
 *   (текстовые рендеры этих типов — в orders-render.ts).
 */
import { randomUUID } from 'node:crypto';
import { AppError } from '../../api/errors.js';
import { moneyToNumberOrNull, numberToQuotation, quotationToNumberOrNull } from '../../api/money.js';
import type { BondResponse, GetLastPricesResponse } from '../../api/types.js';
import type { GetOrderBookResponse } from '../../api/types-market.js';
import type {
  CancelOrderResponse,
  GetMaxLotsResponse,
  GetOrderPriceResponse,
  GetOrdersResponse,
  OrderState,
  PostOrderRequest,
  PostOrderResponse,
  ReplaceOrderRequest,
} from '../../api/types-trading.js';
import { MARKET_ORDER_MAX_SPREAD_PERCENT, type TInvestMode, type TradingGate } from '../../config/config.js';
import { directionFromApi, orderDirectionToApi, type TradeDirection } from '../../format/direction.js';
import { appendTradeAudit } from '../../util/audit.js';
import { resolveAccountId, type AccountsApi } from '../resolve-account.js';
import { resolveInstrument, resolveLabelByFigi, type InstrumentSearchApi } from '../resolve-instrument.js';
import { assertMarketOrderLiquidity, assertMutationAllowed, tradingPathsForMode } from './paths.js';
import { priceTypeFor } from './price-type.js';
import { pricingForFigi, priceUnitsByFigi, resolvePricingContext } from './pricing-context.js';
import { priceUnitFromCurrency, type PriceUnit } from '../../format/units.js';

export interface TradingApi extends AccountsApi, InstrumentSearchApi {
  call<T>(methodPath: string, body: unknown): Promise<T>;
  getLastPrices(instrumentIds: string[]): Promise<GetLastPricesResponse>;
  // Карточка облигации по UID — для номинала (рублёвый эквивалент цены в пунктах).
  getBondBy(uid: string): Promise<BondResponse>;
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
  priceUnit: PriceUnit; // 'point' (облигации/фьючерсы) | 'currency' — единица цены
  nominalRub: number | null; // номинал облигации для ₽-эквивалента (иначе null)
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
    priceUnit: PriceUnit;
    nominalRub: number | null;
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
    priceUnit: base.priceUnit,
    nominalRub: base.nominalRub,
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
    tradingGate: TradingGate;
  },
): Promise<PlacedOrderView> {
  // Предохранитель ДО любых сетевых вызовов (в full — требует full-сессию).
  assertMutationAllowed(params.mode, params.confirm, params.tradingGate);
  const paths = tradingPathsForMode(params.mode);
  // Резолвы счёта и инструмента независимы — параллелим (экономия round-trip).
  const [accountId, instrument] = await Promise.all([
    resolveAccountId(api, params.explicitAccountId),
    resolveTradeInstrument(api, params.query),
  ]);

  const clientOrderId = params.orderId ?? randomUUID();
  const orderType = params.limitPrice !== null ? 'limit' : 'market';

  // Гард ликвидности для РЕАЛЬНОЙ рыночной заявки: рыночное исполнение на
  // неликвиде/широком спреде может сильно проиграть в цене. Смотрим стакан и
  // блокируем, требуя лимитную. Песочница (виртуальные деньги) не проверяется.
  if (params.mode === 'full' && orderType === 'market') {
    const book = await api.call<GetOrderBookResponse>('MarketDataService/GetOrderBook', {
      instrumentId: instrument.uid,
      depth: 1,
    });
    assertMarketOrderLiquidity(
      quotationToNumberOrNull(book.bids?.[0]?.price),
      quotationToNumberOrNull(book.asks?.[0]?.price),
      MARKET_ORDER_MAX_SPREAD_PERCENT,
    );
  }

  // Лимитная цена уходит вместе с priceType по типу инструмента: для облигаций
  // и фьючерсов — в пунктах (POINT), иначе — в валюте (CURRENCY). Без этого
  // цена облигации трактуется как рубли и отклоняется как «вне коридора цен».
  // У рыночной заявки цены нет — priceType не нужен (нечего трактовать).
  const request: PostOrderRequest = {
    accountId,
    instrumentId: instrument.uid,
    quantity: String(params.lots),
    direction: orderDirectionToApi(params.direction),
    orderType: orderType === 'limit' ? 'ORDER_TYPE_LIMIT' : 'ORDER_TYPE_MARKET',
    orderId: clientOrderId,
    ...(params.limitPrice !== null
      ? { price: numberToQuotation(params.limitPrice), priceType: priceTypeFor(instrument.instrumentType) }
      : {}),
  };
  announceIdempotencyKey(clientOrderId);
  const resp = await api.call<PostOrderResponse>(paths.postOrder, request);
  // Единица цены и номинал (для ₽-эквивалента) — после исполнения заявки, чтобы
  // презентационный запрос номинала не задерживал саму мутацию (best-effort).
  const pricing = await resolvePricingContext(api, instrument.instrumentType, instrument.uid);
  // Направление известно из запроса пользователя — берём его, а не из ответа.
  const view = toPlacedView(resp, {
    ticker: instrument.ticker,
    direction: params.direction,
    orderType,
    clientOrderId,
    priceUnit: pricing.priceUnit,
    nominalRub: pricing.nominalRub,
  });
  // Аудит исполненной мутации (best-effort, не роняет команду).
  appendTradeAudit({
    at: new Date().toISOString(),
    mode: params.mode,
    action: params.direction,
    ticker: view.ticker,
    lots: view.lotsRequested,
    orderType,
    price: view.executedPrice,
    amount: view.totalAmount,
    commission: view.commission,
    currency: view.currency,
    orderId: view.orderId,
    idempotencyKey: clientOrderId,
    status: view.statusText,
  });
  return view;
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
  priceUnit: PriceUnit; // единица priceUsed: 'point' (облигации/фьючерсы) | 'currency'
  nominalRub: number | null; // номинал облигации для ₽-эквивалента (иначе null)
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

  // Единица цены и номинал (для ₽-эквивалента и предупреждения о заниженной
  // оценке суммы по облигациям — см. рендер предпросмотра).
  const pricing = await resolvePricingContext(api, instrument.instrumentType, instrument.uid);

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
    priceUnit: pricing.priceUnit,
    nominalRub: pricing.nominalRub,
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
  priceUnit: PriceUnit; // единица initialPrice: 'point' (облигации/фьючерсы) | 'currency'
  nominalRub: number | null; // номинал для ₽-эквивалента (в таблице null — не тянем)
}

// pricing по умолчанию — валюта без номинала: инструмент не резолвлен или
// это акция/фонд. Облигации/фьючерсы каллеры помечают явно (см. listOrders/orderStatus).
export function toOrderStateView(
  order: OrderState,
  pricing: { priceUnit: PriceUnit; nominalRub: number | null } = { priceUnit: 'currency', nominalRub: null },
): OrderStateView {
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
    // Единицу цены берём из валюты самого поля initialSecurityPrice (контуры
    // отдают её в разных единицах: бой — пункты, песочница — рубли); тип
    // инструмента (pricing.priceUnit) — фолбэк, если валюта не пришла.
    priceUnit: priceUnitFromCurrency(order.initialSecurityPrice?.currency) ?? pricing.priceUnit,
    nominalRub: pricing.nominalRub,
  };
}

export async function listOrders(
  api: TradingApi,
  params: { mode: TInvestMode; explicitAccountId?: string },
): Promise<OrderStateView[]> {
  const paths = tradingPathsForMode(params.mode);
  const accountId = await resolveAccountId(api, params.explicitAccountId);
  const resp = await api.call<GetOrdersResponse>(paths.getOrders, { accountId });
  const orders = resp.orders ?? [];
  // Единица цены по каждому figi (батч, троттлинг) — чтобы облигации в таблице
  // помечались «пт», а не выглядели как рубли. Номинал в таблице не тянем.
  const units = await priceUnitsByFigi(api, orders.map((o) => o.figi ?? ''));
  return orders.map((o) =>
    toOrderStateView(o, { priceUnit: (o.figi && units.get(o.figi)) || 'currency', nominalRub: null }),
  );
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
  // Детальный вывод — полный контекст (единица + номинал для ₽-эквивалента).
  const pricing = await pricingForFigi(api, resp.figi ?? '');
  return toOrderStateView(resp, pricing);
}

export async function cancelOrder(
  api: TradingApi,
  params: {
    mode: TInvestMode;
    explicitAccountId?: string;
    orderId: string;
    confirm: boolean;
    tradingGate: TradingGate;
  },
): Promise<{ cancelledAt: string | null }> {
  assertMutationAllowed(params.mode, params.confirm, params.tradingGate);
  const paths = tradingPathsForMode(params.mode);
  const accountId = await resolveAccountId(api, params.explicitAccountId);
  const resp = await api.call<CancelOrderResponse>(paths.cancelOrder, {
    accountId,
    orderId: params.orderId,
  });
  appendTradeAudit({
    at: new Date().toISOString(),
    mode: params.mode,
    action: 'cancel',
    ticker: null, // у отмены известен только номер заявки
    orderId: params.orderId,
    status: resp.time ? 'отменена' : 'отмена отправлена',
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
    tradingGate: TradingGate;
  },
): Promise<PlacedOrderView> {
  assertMutationAllowed(params.mode, params.confirm, params.tradingGate);
  const paths = tradingPathsForMode(params.mode);
  const accountId = await resolveAccountId(api, params.explicitAccountId);
  // priceType для замены задаётся по типу инструмента, но ReplaceOrder работает
  // по orderId и типа бумаги не знает. Читаем состояние заявки (безопасно, это
  // чтение) → figi → карточку инструмента, ещё ДО отправки замены. Так же
  // получаем ticker для подтверждения (ответ ReplaceOrder ticker не содержит).
  const state = await api.call<OrderState>(paths.getOrderState, {
    accountId,
    orderId: params.orderId,
  });
  const instrument = await resolveLabelByFigi(api, state.figi ?? '');
  // Тип инструмента — обязательные данные для корректной цены (пункты/валюта).
  // Не смогли определить — не заменяем: слепой priceType по облигации выставил
  // бы цену неверного типа (no-fallbacks — не угадываем валюту вместо пунктов).
  if (!instrument) {
    throw new AppError({
      code: 'APP_TINVEST_ORDER_INSTRUMENT_UNKNOWN',
      userMessage:
        `Не удалось определить инструмент заявки ${params.orderId} — замена отменена, ` +
        'чтобы не выставить цену неверного типа. Проверьте номер заявки: order status.',
    });
  }
  // Ключ идемпотентности замены: свой (для безопасного повтора при таймауте)
  // или сгенерированный. Раньше он всегда был случайным — повтор замены
  // отправлял новый ключ, и API не мог сопоставить его с первым запросом.
  const idempotencyKey = params.newOrderId ?? randomUUID();
  announceIdempotencyKey(idempotencyKey);
  const replaceRequest: ReplaceOrderRequest = {
    accountId,
    orderId: params.orderId,
    idempotencyKey,
    quantity: String(params.lots),
    price: numberToQuotation(params.price),
    priceType: priceTypeFor(instrument.instrumentType),
  };
  const resp = await api.call<PostOrderResponse>(paths.replaceOrder, replaceRequest);
  // Единица цены и номинал (для ₽-эквивалента) по уже известному инструменту заявки.
  const pricing = await resolvePricingContext(api, instrument.instrumentType, instrument.uid);
  const view = toPlacedView(resp, {
    ticker: instrument.ticker,
    // Направление берём из ответа; при отсутствии поля — null, не «покупка».
    direction: directionFromApi(resp.direction),
    orderType: 'limit',
    clientOrderId: idempotencyKey,
    priceUnit: pricing.priceUnit,
    nominalRub: pricing.nominalRub,
  });
  appendTradeAudit({
    at: new Date().toISOString(),
    mode: params.mode,
    action: 'replace',
    ticker: view.ticker,
    lots: params.lots,
    orderType: 'limit',
    price: params.price,
    orderId: view.orderId,
    idempotencyKey,
    status: view.statusText,
  });
  return view;
}
