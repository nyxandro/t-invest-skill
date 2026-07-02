/**
 * Тесты торгового блока: предохранители режимов, сборка запросов заявок
 * (рыночная/лимитная/стоп), предпросмотр и статусы.
 */
import { describe, expect, it } from 'vitest';
import type { GetAccountsResponse } from '../../api/types.js';
import { assertMutationAllowed, tradingPathsForMode } from './paths.js';
import { cancelOrder, placeOrder, previewOrder, type TradingApi } from './orders.js';
import { placeStopOrder } from './stop-orders.js';

// Мок клиента: собирает вызовы call и отвечает заготовками по пути метода.
function makeApi(responses: Record<string, unknown> = {}) {
  const calls: { path: string; body: unknown }[] = [];
  const api: TradingApi = {
    async getAccounts(): Promise<GetAccountsResponse> {
      return {
        accounts: [
          { id: 'acc-1', type: 'ACCOUNT_TYPE_TINKOFF', name: 'Брокерский', status: 'ACCOUNT_STATUS_OPEN', accessLevel: 'ACCOUNT_ACCESS_LEVEL_FULL_ACCESS' },
        ],
      };
    },
    async findInstrument() {
      return {
        instruments: [
          {
            uid: 'uid-sber',
            figi: 'BBG004730N88',
            ticker: 'SBER',
            classCode: 'TQBR',
            instrumentType: 'share',
            name: 'Сбер Банк',
            lot: 10,
            apiTradeAvailableFlag: true,
          },
        ],
      };
    },
    async getLastPrices() {
      return {
        lastPrices: [{ figi: 'BBG004730N88', instrumentUid: 'uid-sber', price: { units: '300', nano: 0 } }],
      };
    },
    async call<T>(path: string, body: unknown): Promise<T> {
      calls.push({ path, body });
      return (responses[path] ?? {}) as T;
    },
  };
  return { api, calls };
}

describe('предохранители торговых команд', () => {
  it('readonly: любая мутация запрещена кодом', () => {
    expect(() => assertMutationAllowed('readonly', true)).toThrowError(
      expect.objectContaining({ code: 'APP_TINVEST_TRADING_FORBIDDEN' }),
    );
  });

  it('full: мутация без --confirm отклоняется', () => {
    expect(() => assertMutationAllowed('full', false)).toThrowError(
      expect.objectContaining({ code: 'APP_TINVEST_CONFIRM_REQUIRED' }),
    );
    expect(() => assertMutationAllowed('full', true)).not.toThrow();
  });

  it('sandbox: подтверждение не требуется', () => {
    expect(() => assertMutationAllowed('sandbox', false)).not.toThrow();
  });

  it('пути методов: sandbox → SandboxService, боевой → OrdersService', () => {
    expect(tradingPathsForMode('sandbox').postOrder).toBe('SandboxService/PostSandboxOrder');
    expect(tradingPathsForMode('full').postOrder).toBe('OrdersService/PostOrder');
    expect(tradingPathsForMode('full').postStopOrder).toBe('StopOrdersService/PostStopOrder');
  });
});

describe('placeOrder', () => {
  it('собирает лимитную заявку и маппит ответ', async () => {
    const { api, calls } = makeApi({
      'SandboxService/PostSandboxOrder': {
        orderId: 'srv-1',
        executionReportStatus: 'EXECUTION_REPORT_STATUS_FILL',
        lotsRequested: '2',
        lotsExecuted: '2',
        totalOrderAmount: { currency: 'rub', units: '6000', nano: 0 },
      },
    });
    const view = await placeOrder(api, {
      mode: 'sandbox',
      query: 'SBER',
      lots: 2,
      direction: 'buy',
      limitPrice: 300.5,
      confirm: false,
    });
    expect(calls[0]?.path).toBe('SandboxService/PostSandboxOrder');
    expect(calls[0]?.body).toMatchObject({
      accountId: 'acc-1',
      instrumentId: 'uid-sber',
      quantity: '2',
      direction: 'ORDER_DIRECTION_BUY',
      orderType: 'ORDER_TYPE_LIMIT',
      price: { units: '300', nano: 500000000 },
    });
    // Ключ идемпотентности сгенерирован и отправлен.
    expect((calls[0]?.body as { orderId: string }).orderId).toMatch(/[0-9a-f-]{36}/);
    expect(view).toMatchObject({ orderId: 'srv-1', statusText: 'исполнена', totalAmount: 6000 });
  });

  it('без цены — рыночная заявка без поля price', async () => {
    const { api, calls } = makeApi();
    await placeOrder(api, {
      mode: 'sandbox',
      query: 'SBER',
      lots: 1,
      direction: 'sell',
      limitPrice: null,
      confirm: false,
    });
    expect(calls[0]?.body).toMatchObject({ orderType: 'ORDER_TYPE_MARKET', direction: 'ORDER_DIRECTION_SELL' });
    expect(calls[0]?.body).not.toHaveProperty('price');
  });

  it('readonly отклоняется ДО сетевых вызовов', async () => {
    const { api, calls } = makeApi();
    await expect(
      placeOrder(api, { mode: 'readonly', query: 'SBER', lots: 1, direction: 'buy', limitPrice: null, confirm: true }),
    ).rejects.toMatchObject({ code: 'APP_TINVEST_TRADING_FORBIDDEN' });
    expect(calls).toEqual([]);
  });

  it('full без confirm отклоняется ДО сетевых вызовов', async () => {
    const { api, calls } = makeApi();
    await expect(
      placeOrder(api, { mode: 'full', query: 'SBER', lots: 1, direction: 'buy', limitPrice: 300, confirm: false }),
    ).rejects.toMatchObject({ code: 'APP_TINVEST_CONFIRM_REQUIRED' });
    expect(calls).toEqual([]);
  });
});

describe('previewOrder', () => {
  it('без лимитной цены берёт последнюю рыночную и оценивает сумму', async () => {
    const { api, calls } = makeApi({
      'SandboxService/GetSandboxMaxLots': {
        currency: 'rub',
        buyLimits: { buyMoneyAmount: { units: '10000', nano: 0 }, buyMaxLots: '3' },
        sellLimits: { sellMaxLots: '5' },
      },
      'SandboxService/GetSandboxOrderPrice': {
        totalOrderAmount: { currency: 'rub', units: '3003', nano: 0 },
        executedCommission: { currency: 'rub', units: '3', nano: 0 },
      },
    });
    const view = await previewOrder(api, {
      mode: 'sandbox',
      query: 'SBER',
      lots: 1,
      direction: 'buy',
      limitPrice: null,
    });
    expect(view).toMatchObject({
      priceUsed: 300,
      priceSource: 'last-price',
      estimatedAmount: 3003,
      commission: 3,
      maxBuyLots: 3,
      maxSellLots: 5,
      availableMoney: 10000,
      lotSize: 10,
    });
    // GetOrderPrice вызван с ценой из последней сделки.
    const priceCall = calls.find((c) => c.path.endsWith('GetSandboxOrderPrice'));
    expect(priceCall?.body).toMatchObject({ price: { units: '300', nano: 0 } });
  });
});

describe('cancelOrder / placeStopOrder', () => {
  it('отмена заявки в full с confirm', async () => {
    const { api, calls } = makeApi({ 'OrdersService/CancelOrder': { time: '2026-07-02T12:00:00Z' } });
    const result = await cancelOrder(api, { mode: 'full', orderId: 'ord-1', confirm: true });
    expect(result.cancelledAt).toBe('2026-07-02T12:00:00Z');
    expect(calls[0]?.body).toMatchObject({ accountId: 'acc-1', orderId: 'ord-1' });
  });

  it('стоп-лимит требует лимитную цену', async () => {
    const { api } = makeApi();
    await expect(
      placeStopOrder(api, {
        mode: 'sandbox',
        query: 'SBER',
        lots: 1,
        kind: 'stop-limit',
        direction: 'sell',
        stopPrice: 290,
        limitPrice: null,
        confirm: false,
      }),
    ).rejects.toMatchObject({ code: 'APP_CLI_INVALID_ARGUMENT' });
  });

  it('тейк-профит собирает корректный запрос', async () => {
    const { api, calls } = makeApi({ 'SandboxService/PostSandboxStopOrder': { stopOrderId: 'stop-1' } });
    const view = await placeStopOrder(api, {
      mode: 'sandbox',
      query: 'SBER',
      lots: 3,
      kind: 'take-profit',
      direction: 'sell',
      stopPrice: 350,
      limitPrice: null,
      confirm: false,
    });
    expect(calls[0]?.body).toMatchObject({
      stopOrderType: 'STOP_ORDER_TYPE_TAKE_PROFIT',
      direction: 'STOP_ORDER_DIRECTION_SELL',
      quantity: '3',
      stopPrice: { units: '350', nano: 0 },
      expirationType: 'STOP_ORDER_EXPIRATION_TYPE_GOOD_TILL_CANCEL',
    });
    expect(view.stopOrderId).toBe('stop-1');
  });
});
