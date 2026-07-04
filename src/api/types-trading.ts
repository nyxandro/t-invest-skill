/**
 * Типы торговых сервисов T-Invest API (OrdersService, StopOrdersService
 * и их зеркала в SandboxService).
 *
 * Экспорты:
 * - OrderDirection, OrderType — направления и типы заявок;
 * - PostOrderRequest/Response — выставление заявки;
 * - OrderState, GetOrdersResponse — состояние заявок;
 * - CancelOrderResponse — отмена;
 * - GetMaxLotsResponse — доступные лоты на покупку/продажу;
 * - GetOrderPriceResponse — предварительная стоимость лимитной заявки;
 * - StopOrderDirection, StopOrderType, PostStopOrderRequest/Response,
 *   StopOrderInfo, GetStopOrdersResponse, CancelStopOrderResponse — стоп-заявки.
 *
 * Все поля ответов optional (protobuf-JSON), запросы — строго обязательные
 * поля контракта. Живая проверка возможна только в песочнице.
 */
import type { MoneyValue, Quotation } from './types.js';

export type OrderDirection = 'ORDER_DIRECTION_BUY' | 'ORDER_DIRECTION_SELL';
export type OrderType = 'ORDER_TYPE_LIMIT' | 'ORDER_TYPE_MARKET';

// Тип цены заявки (enum v1PriceType контракта T-Invest API). UNSPECIFIED не
// отправляем осознанно: для облигаций/фьючерсов неопределённый тип трактуется
// сервером как валюта, и цена в пунктах (напр. 103.20 = 103.2 % номинала)
// вылетает за биржевой коридор цен → «price is outside the limits» и отклонение.
// Поэтому тип цены задаётся явно по типу инструмента (см. trading/price-type.ts).
export type PriceType = 'PRICE_TYPE_POINT' | 'PRICE_TYPE_CURRENCY';

// --- PostOrder ---

export interface PostOrderRequest {
  accountId: string;
  instrumentId: string;
  quantity: string; // лоты, int64 → string
  direction: OrderDirection;
  orderType: OrderType;
  orderId: string; // клиентский ключ идемпотентности (UUID)
  price?: Quotation; // только для лимитных заявок
  priceType?: PriceType; // как трактовать price: пункты (облигации/фьючерсы) или валюта
}

// --- ReplaceOrder ---

export interface ReplaceOrderRequest {
  accountId: string;
  orderId: string; // номер заменяемой заявки на бирже
  idempotencyKey: string; // новый клиентский ключ идемпотентности
  quantity: string;
  price: Quotation;
  priceType?: PriceType; // трактовка price — по типу инструмента заявки
}

export interface PostOrderResponse {
  orderId?: string;
  executionReportStatus?: string; // EXECUTION_REPORT_STATUS_FILL | _NEW | _REJECTED | ...
  lotsRequested?: string;
  lotsExecuted?: string;
  initialOrderPrice?: MoneyValue;
  executedOrderPrice?: MoneyValue;
  totalOrderAmount?: MoneyValue;
  initialCommission?: MoneyValue;
  executedCommission?: MoneyValue;
  direction?: string;
  orderType?: string;
  message?: string; // причина отклонения
  instrumentUid?: string;
  figi?: string;
}

// --- GetOrders / GetOrderState ---

export interface OrderState {
  orderId?: string;
  executionReportStatus?: string;
  lotsRequested?: string;
  lotsExecuted?: string;
  initialOrderPrice?: MoneyValue;
  executedOrderPrice?: MoneyValue;
  totalOrderAmount?: MoneyValue;
  initialSecurityPrice?: MoneyValue;
  direction?: string;
  orderType?: string;
  orderDate?: string;
  instrumentUid?: string;
  figi?: string;
  ticker?: string;
}

export interface GetOrdersResponse {
  orders?: OrderState[];
}

export interface CancelOrderResponse {
  time?: string;
}

// --- GetMaxLots ---

export interface GetMaxLotsResponse {
  currency?: string;
  buyLimits?: {
    buyMoneyAmount?: Quotation; // свободные деньги под покупку
    buyMaxLots?: string;
    buyMaxMarketLots?: string;
  };
  buyMarginLimits?: {
    buyMoneyAmount?: Quotation;
    buyMaxLots?: string;
    buyMaxMarketLots?: string;
  };
  sellLimits?: {
    sellMaxLots?: string;
  };
  sellMarginLimits?: {
    sellMaxLots?: string;
  };
}

// --- GetOrderPrice ---

export interface GetOrderPriceResponse {
  totalOrderAmount?: MoneyValue; // полная стоимость заявки с комиссией
  initialOrderAmount?: MoneyValue;
  lotsRequested?: string;
  executedCommission?: MoneyValue;
  executedCommissionRub?: MoneyValue;
  serviceCommission?: MoneyValue;
}

// --- Стоп-заявки ---

export type StopOrderDirection = 'STOP_ORDER_DIRECTION_BUY' | 'STOP_ORDER_DIRECTION_SELL';
export type StopOrderType =
  | 'STOP_ORDER_TYPE_TAKE_PROFIT'
  | 'STOP_ORDER_TYPE_STOP_LOSS'
  | 'STOP_ORDER_TYPE_STOP_LIMIT';

export interface PostStopOrderRequest {
  accountId: string;
  instrumentId: string;
  quantity: string;
  direction: StopOrderDirection;
  stopOrderType: StopOrderType;
  // Бессрочная стоп-заявка — единственный вариант без даты истечения.
  expirationType: 'STOP_ORDER_EXPIRATION_TYPE_GOOD_TILL_CANCEL';
  stopPrice: Quotation; // цена активации
  price?: Quotation; // цена лимитной заявки после активации (stop-limit)
  // Единый тип цены на весь запрос: покрывает и stopPrice, и price. Для
  // облигаций/фьючерсов — POINT (пункты), иначе цена уйдёт как валюта.
  priceType?: PriceType;
  orderId: string; // клиентский ключ идемпотентности
}

export interface PostStopOrderResponse {
  stopOrderId?: string;
  orderRequestId?: string;
}

export interface StopOrderInfo {
  stopOrderId?: string;
  lotsRequested?: string;
  figi?: string;
  instrumentUid?: string;
  direction?: string;
  currency?: string;
  orderType?: string; // тип стоп-заявки
  stopOrderType?: string;
  createDate?: string;
  expirationTime?: string;
  price?: MoneyValue; // лимитная цена (для stop-limit)
  stopPrice?: MoneyValue; // цена активации
  status?: string;
}

export interface GetStopOrdersResponse {
  stopOrders?: StopOrderInfo[];
}

export interface CancelStopOrderResponse {
  time?: string;
}
