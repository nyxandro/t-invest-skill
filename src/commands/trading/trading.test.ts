/**
 * Тесты торгового блока: предохранители режимов (лестница гейтов из окружения),
 * сборка запросов заявок (рыночная/лимитная/стоп), предпросмотр и статусы.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GetAccountsResponse } from '../../api/types.js';
import type { TradingGate } from '../../config/config.js';
import { assertMutationAllowed, tradingPathsForMode } from './paths.js';
import {
  cancelOrder,
  placeOrder,
  previewOrder,
  replaceOrder,
  type TradingApi,
} from './orders.js';
import { listStopOrders, placeStopOrder } from './stop-orders.js';

// Гейты реальных сделок из окружения (см. resolveTradingGate):
// OFF — торговля выключена; CONFIRM — включена, нужна подпись на каждую сделку;
// STONKS — включена без подтверждений (автономно).
const GATE_OFF: TradingGate = { allowTrading: false, stonksMode: false };
const GATE_CONFIRM: TradingGate = { allowTrading: true, stonksMode: false };
const GATE_STONKS: TradingGate = { allowTrading: true, stonksMode: true };

// Мутации печатают ключ идемпотентности в stderr — глушим шум в тестах.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

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

describe('предохранители торговых команд (лестница гейтов)', () => {
  it('readonly: любая мутация запрещена кодом', () => {
    expect(() => assertMutationAllowed('readonly', true, GATE_CONFIRM)).toThrowError(
      expect.objectContaining({ code: 'APP_TINVEST_TRADING_FORBIDDEN' }),
    );
  });

  it('sandbox: подтверждение и флаги окружения не требуются', () => {
    expect(() => assertMutationAllowed('sandbox', false, GATE_OFF)).not.toThrow();
  });

  it('full без флага торговли: сделка запрещена (APP_TINVEST_TRADING_DISABLED)', () => {
    // Само наличие full-токена не открывает реальные сделки — нужен флаг деплоя.
    expect(() => assertMutationAllowed('full', true, GATE_OFF)).toThrowError(
      expect.objectContaining({ code: 'APP_TINVEST_TRADING_DISABLED' }),
    );
  });

  it('full с ALLOW_TRADING: без --confirm отклоняется, с --confirm проходит', () => {
    expect(() => assertMutationAllowed('full', false, GATE_CONFIRM)).toThrowError(
      expect.objectContaining({ code: 'APP_TINVEST_CONFIRM_REQUIRED' }),
    );
    expect(() => assertMutationAllowed('full', true, GATE_CONFIRM)).not.toThrow();
  });

  it('full со STONKS_MODE: сделка проходит без подтверждения', () => {
    expect(() => assertMutationAllowed('full', false, GATE_STONKS)).not.toThrow();
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
      tradingGate: GATE_OFF,
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
      tradingGate: GATE_OFF,
    });
    expect(calls[0]?.body).toMatchObject({ orderType: 'ORDER_TYPE_MARKET', direction: 'ORDER_DIRECTION_SELL' });
    expect(calls[0]?.body).not.toHaveProperty('price');
  });

  it('readonly отклоняется ДО сетевых вызовов', async () => {
    const { api, calls } = makeApi();
    await expect(
      placeOrder(api, { mode: 'readonly', query: 'SBER', lots: 1, direction: 'buy', limitPrice: null, confirm: true, tradingGate: GATE_CONFIRM }),
    ).rejects.toMatchObject({ code: 'APP_TINVEST_TRADING_FORBIDDEN' });
    expect(calls).toEqual([]);
  });

  it('full без confirm отклоняется ДО сетевых вызовов', async () => {
    const { api, calls } = makeApi();
    await expect(
      placeOrder(api, { mode: 'full', query: 'SBER', lots: 1, direction: 'buy', limitPrice: 300, confirm: false, tradingGate: GATE_CONFIRM }),
    ).rejects.toMatchObject({ code: 'APP_TINVEST_CONFIRM_REQUIRED' });
    expect(calls).toEqual([]);
  });

  it('full без разрешающего флага отклоняется ДО сетевых вызовов (гейт денег)', async () => {
    const { api, calls } = makeApi();
    await expect(
      placeOrder(api, { mode: 'full', query: 'SBER', lots: 1, direction: 'buy', limitPrice: 300, confirm: true, tradingGate: GATE_OFF }),
    ).rejects.toMatchObject({ code: 'APP_TINVEST_TRADING_DISABLED' });
    expect(calls).toEqual([]);
  });

  it('full со stonks исполняет заявку без confirm', async () => {
    const { api, calls } = makeApi({
      'OrdersService/PostOrder': { orderId: 'srv-2', executionReportStatus: 'EXECUTION_REPORT_STATUS_FILL' },
    });
    await placeOrder(api, {
      mode: 'full',
      query: 'SBER',
      lots: 1,
      direction: 'buy',
      limitPrice: 300,
      confirm: false,
      tradingGate: GATE_STONKS,
    });
    expect(calls[0]?.path).toBe('OrdersService/PostOrder');
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
    // previewOrder — чтение, гейт торговли не требуется.
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
  it('отмена заявки в full с confirm и включённой торговлей', async () => {
    const { api, calls } = makeApi({ 'OrdersService/CancelOrder': { time: '2026-07-02T12:00:00Z' } });
    const result = await cancelOrder(api, { mode: 'full', orderId: 'ord-1', confirm: true, tradingGate: GATE_CONFIRM });
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
        tradingGate: GATE_OFF,
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
      tradingGate: GATE_OFF,
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

describe('replaceOrder', () => {
  it('использует переданный --order-id как ключ идемпотентности (K16)', async () => {
    const { api, calls } = makeApi({ 'SandboxService/ReplaceSandboxOrder': { orderId: 'srv-9' } });
    await replaceOrder(api, {
      mode: 'sandbox',
      orderId: 'ord-1',
      lots: 2,
      price: 305,
      newOrderId: 'my-key-123',
      confirm: false,
      tradingGate: GATE_OFF,
    });
    // Ключ идемпотентности замены — наш, а не случайный: повтор безопасен.
    expect(calls[0]?.body).toMatchObject({ orderId: 'ord-1', idempotencyKey: 'my-key-123' });
  });

  it('направление из ответа без поля direction → null, а не «покупка» (K19)', async () => {
    // protobuf опускает незаполненный direction: замена sell-заявки не должна
    // рапортоваться как покупка.
    const { api } = makeApi({ 'SandboxService/ReplaceSandboxOrder': { orderId: 'srv-9' } });
    const view = await replaceOrder(api, {
      mode: 'sandbox',
      orderId: 'ord-1',
      lots: 2,
      price: 305,
      confirm: false,
      tradingGate: GATE_OFF,
    });
    expect(view.direction).toBeNull();
  });

  it('направление sell из ответа маппится в sell (K19)', async () => {
    const { api } = makeApi({
      'SandboxService/ReplaceSandboxOrder': { orderId: 'srv-9', direction: 'ORDER_DIRECTION_SELL' },
    });
    const view = await replaceOrder(api, {
      mode: 'sandbox',
      orderId: 'ord-1',
      lots: 2,
      price: 305,
      confirm: false,
      tradingGate: GATE_OFF,
    });
    expect(view.direction).toBe('sell');
  });

  it('резолвит тикер по figi из ответа, а не показывает сырой FIGI', async () => {
    // Ответ ReplaceOrder содержит только figi (без ticker) — вывод должен
    // показать бумагу «SBER», резолвленную через findInstrument по figi.
    const { api } = makeApi({
      'SandboxService/ReplaceSandboxOrder': { orderId: 'srv-9', figi: 'BBG004730N88' },
    });
    const view = await replaceOrder(api, {
      mode: 'sandbox',
      orderId: 'ord-1',
      lots: 2,
      price: 305,
      confirm: false,
      tradingGate: GATE_OFF,
    });
    expect(view.ticker).toBe('SBER');
  });
});

describe('listStopOrders', () => {
  it('резолвит тикер по figi (стоп-лист API не отдаёт ticker)', async () => {
    // GetStopOrders возвращает только figi — список должен показать «SBER»,
    // а не FIGI (регрессия, найденная e2e-прогоном в песочнице).
    const { api } = makeApi({
      'SandboxService/GetSandboxStopOrders': {
        stopOrders: [
          {
            stopOrderId: 's1',
            figi: 'BBG004730N88',
            direction: 'STOP_ORDER_DIRECTION_SELL',
            lotsRequested: '1',
            stopPrice: { currency: 'rub', units: '320', nano: 0 },
          },
        ],
      },
    });
    const views = await listStopOrders(api, { mode: 'sandbox' });
    expect(views[0]?.ticker).toBe('SBER');
  });
});
