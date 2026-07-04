/**
 * Тесты торгового блока: предохранители режимов (лестница гейтов из окружения),
 * сборка запросов заявок (рыночная/лимитная/стоп), предпросмотр и статусы.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GetAccountsResponse, InstrumentShort } from '../../api/types.js';
import type { TradingGate } from '../../config/config.js';
import { assertMarketOrderLiquidity, assertMutationAllowed, tradingPathsForMode } from './paths.js';
import {
  cancelOrder,
  placeOrder,
  previewOrder,
  replaceOrder,
  type TradingApi,
} from './orders.js';
import { renderOrderPreview, renderPlacedOrder } from './orders-render.js';
import { listStopOrders, placeStopOrder, renderPlacedStopOrder } from './stop-orders.js';

// Журнал сделок пишет в реальный ~/.config/tinvest/trades.log — в тестах глушим,
// чтобы прогон не засорял файл пользователя (сама логика журнала — в audit.test.ts).
vi.mock('../../util/audit.js', () => ({ appendTradeAudit: () => {} }));

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

// Инструмент по умолчанию — акция SBER; для проверок priceType облигаций
// тесты передают BOND_INSTRUMENT (тип 'bond' → цена в пунктах → POINT).
const SBER_INSTRUMENT: InstrumentShort = {
  uid: 'uid-sber',
  figi: 'BBG004730N88',
  ticker: 'SBER',
  classCode: 'TQBR',
  instrumentType: 'share',
  name: 'Сбер Банк',
  lot: 10,
  apiTradeAvailableFlag: true,
};

const BOND_INSTRUMENT: InstrumentShort = {
  uid: 'uid-bond',
  figi: 'BBG-BOND-1',
  ticker: 'BONDX',
  classCode: 'TQCB',
  isin: 'RU000A10B214',
  instrumentType: 'bond',
  name: 'Тест-облигация',
  lot: 1,
  apiTradeAvailableFlag: true,
};

// Мок клиента: собирает вызовы call и отвечает заготовками по пути метода.
// instrument — какую бумагу возвращает findInstrument (по тикеру/ISIN и по figi).
function makeApi(
  responses: Record<string, unknown> = {},
  instrument: InstrumentShort = SBER_INSTRUMENT,
) {
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
      return { instruments: [instrument] };
    },
    async getLastPrices() {
      return {
        lastPrices: [{ figi: instrument.figi, instrumentUid: instrument.uid, price: { units: '300', nano: 0 } }],
      };
    },
    // Карточка облигации для рублёвого эквивалента: номинал 1000 ₽.
    async getBondBy() {
      return {
        instrument: {
          uid: instrument.uid,
          figi: instrument.figi,
          ticker: instrument.ticker,
          classCode: instrument.classCode,
          isin: instrument.isin ?? '',
          name: instrument.name,
          currency: 'rub',
          nominal: { units: '1000', nano: 0, currency: 'rub' },
        },
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

describe('assertMarketOrderLiquidity (гард спреда рыночной заявки)', () => {
  it('узкий спред — проходит', () => {
    expect(() => assertMarketOrderLiquidity(100, 100.2, 1)).not.toThrow();
  });

  it('широкий спред — APP_TINVEST_WIDE_SPREAD', () => {
    expect(() => assertMarketOrderLiquidity(100, 110, 1)).toThrowError(
      expect.objectContaining({ code: 'APP_TINVEST_WIDE_SPREAD' }),
    );
  });

  it('нет двусторонних котировок — APP_TINVEST_ILLIQUID_MARKET', () => {
    expect(() => assertMarketOrderLiquidity(null, 100, 1)).toThrowError(
      expect.objectContaining({ code: 'APP_TINVEST_ILLIQUID_MARKET' }),
    );
    expect(() => assertMarketOrderLiquidity(100, null, 1)).toThrowError(
      expect.objectContaining({ code: 'APP_TINVEST_ILLIQUID_MARKET' }),
    );
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
      // Акция — цена в валюте расчётов.
      priceType: 'PRICE_TYPE_CURRENCY',
    });
    // Ключ идемпотентности сгенерирован и отправлен.
    expect((calls[0]?.body as { orderId: string }).orderId).toMatch(/[0-9a-f-]{36}/);
    expect(view).toMatchObject({ orderId: 'srv-1', statusText: 'исполнена', totalAmount: 6000 });
  });

  it('облигация: лимитная заявка уходит с priceType POINT (цена в пунктах)', async () => {
    // Регрессия: без PRICE_TYPE_POINT цена облигации (напр. 103.20 = % номинала)
    // трактуется как рубли и отклоняется — «price is outside the limits».
    const { api, calls } = makeApi(
      { 'SandboxService/PostSandboxOrder': { orderId: 'srv-b', executionReportStatus: 'EXECUTION_REPORT_STATUS_NEW' } },
      BOND_INSTRUMENT,
    );
    await placeOrder(api, {
      mode: 'sandbox',
      query: 'RU000A10B214',
      lots: 15,
      direction: 'buy',
      limitPrice: 103.2,
      confirm: false,
      tradingGate: GATE_OFF,
    });
    expect(calls[0]?.body).toMatchObject({
      instrumentId: 'uid-bond',
      price: { units: '103', nano: 200000000 },
      priceType: 'PRICE_TYPE_POINT',
    });
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
    // У рыночной заявки цены нет — priceType не отправляем (нечего трактовать).
    expect(calls[0]?.body).not.toHaveProperty('priceType');
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

  it('full РЫНОЧНАЯ заявка блокируется при широком спреде (до PostOrder)', async () => {
    const { api, calls } = makeApi({
      'MarketDataService/GetOrderBook': {
        bids: [{ price: { units: '100', nano: 0 }, quantity: '1' }],
        asks: [{ price: { units: '110', nano: 0 }, quantity: '1' }],
      },
    });
    await expect(
      placeOrder(api, { mode: 'full', query: 'SBER', lots: 1, direction: 'buy', limitPrice: null, confirm: true, tradingGate: GATE_CONFIRM }),
    ).rejects.toMatchObject({ code: 'APP_TINVEST_WIDE_SPREAD' });
    expect(calls.some((c) => c.path === 'OrdersService/PostOrder')).toBe(false);
  });

  it('full РЫНОЧНАЯ заявка проходит при узком спреде', async () => {
    const { api, calls } = makeApi({
      'MarketDataService/GetOrderBook': {
        bids: [{ price: { units: '100', nano: 0 }, quantity: '1' }],
        asks: [{ price: { units: '100', nano: 200000000 }, quantity: '1' }],
      },
      'OrdersService/PostOrder': { orderId: 'srv-3', executionReportStatus: 'EXECUTION_REPORT_STATUS_FILL' },
    });
    await placeOrder(api, { mode: 'full', query: 'SBER', lots: 1, direction: 'buy', limitPrice: null, confirm: true, tradingGate: GATE_CONFIRM });
    expect(calls.some((c) => c.path === 'OrdersService/PostOrder')).toBe(true);
  });

  it('full ЛИМИТНАЯ заявка не дёргает стакан (гард только для рыночных)', async () => {
    const { api, calls } = makeApi({
      'OrdersService/PostOrder': { orderId: 'srv-4', executionReportStatus: 'EXECUTION_REPORT_STATUS_NEW' },
    });
    await placeOrder(api, { mode: 'full', query: 'SBER', lots: 1, direction: 'buy', limitPrice: 300, confirm: true, tradingGate: GATE_CONFIRM });
    expect(calls.some((c) => c.path === 'MarketDataService/GetOrderBook')).toBe(false);
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
      // Акция — стоп-цена в валюте.
      priceType: 'PRICE_TYPE_CURRENCY',
    });
    expect(view.stopOrderId).toBe('stop-1');
  });

  it('облигация: стоп-заявка уходит с priceType POINT (stopPrice в пунктах)', async () => {
    const { api, calls } = makeApi({ 'SandboxService/PostSandboxStopOrder': { stopOrderId: 'stop-b' } }, BOND_INSTRUMENT);
    await placeStopOrder(api, {
      mode: 'sandbox',
      query: 'RU000A10B214',
      lots: 1,
      kind: 'stop-loss',
      direction: 'sell',
      stopPrice: 99.5,
      limitPrice: null,
      confirm: false,
      tradingGate: GATE_OFF,
    });
    expect(calls[0]?.body).toMatchObject({
      instrumentId: 'uid-bond',
      stopPrice: { units: '99', nano: 500000000 },
      priceType: 'PRICE_TYPE_POINT',
    });
  });
});

describe('replaceOrder', () => {
  // Замена читает состояние заявки (GetOrderState) → figi → тип инструмента,
  // чтобы задать priceType. Поэтому мок обязан вернуть figi заменяемой заявки.
  const STATE_SBER = { 'SandboxService/GetSandboxOrderState': { figi: 'BBG004730N88' } };
  const replaceBody = (calls: { path: string; body: unknown }[]) =>
    calls.find((c) => c.path.endsWith('ReplaceSandboxOrder'))?.body;

  it('использует переданный --order-id как ключ идемпотентности (K16)', async () => {
    const { api, calls } = makeApi({ ...STATE_SBER, 'SandboxService/ReplaceSandboxOrder': { orderId: 'srv-9' } });
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
    // Акция → priceType валюта.
    expect(replaceBody(calls)).toMatchObject({
      orderId: 'ord-1',
      idempotencyKey: 'my-key-123',
      priceType: 'PRICE_TYPE_CURRENCY',
    });
  });

  it('направление из ответа без поля direction → null, а не «покупка» (K19)', async () => {
    // protobuf опускает незаполненный direction: замена sell-заявки не должна
    // рапортоваться как покупка.
    const { api } = makeApi({ ...STATE_SBER, 'SandboxService/ReplaceSandboxOrder': { orderId: 'srv-9' } });
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
      ...STATE_SBER,
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

  it('резолвит тикер по figi заявки, а не показывает сырой FIGI', async () => {
    // GetOrderState даёт только figi (без ticker) — вывод должен показать
    // бумагу «SBER», резолвленную через findInstrument по figi заявки.
    const { api } = makeApi({ ...STATE_SBER, 'SandboxService/ReplaceSandboxOrder': { orderId: 'srv-9' } });
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

  it('облигация: замена уходит с priceType POINT (тип берётся из заявки)', async () => {
    const { api, calls } = makeApi(
      {
        'SandboxService/GetSandboxOrderState': { figi: 'BBG-BOND-1' },
        'SandboxService/ReplaceSandboxOrder': { orderId: 'srv-b' },
      },
      BOND_INSTRUMENT,
    );
    await replaceOrder(api, {
      mode: 'sandbox',
      orderId: 'ord-b',
      lots: 5,
      price: 101.5,
      confirm: false,
      tradingGate: GATE_OFF,
    });
    expect(replaceBody(calls)).toMatchObject({
      price: { units: '101', nano: 500000000 },
      priceType: 'PRICE_TYPE_POINT',
    });
  });

  it('инструмент заявки не определён (нет figi) → замена отклонена ДО отправки', async () => {
    // Без типа инструмента нельзя выбрать priceType — не угадываем валюту
    // вместо пунктов (no-fallbacks), а падаем и не трогаем заявку.
    const { api, calls } = makeApi({ 'SandboxService/GetSandboxOrderState': {} });
    await expect(
      replaceOrder(api, { mode: 'sandbox', orderId: 'ord-x', lots: 1, price: 100, confirm: false, tradingGate: GATE_OFF }),
    ).rejects.toMatchObject({ code: 'APP_TINVEST_ORDER_INSTRUMENT_UNKNOWN' });
    expect(calls.some((c) => c.path.endsWith('ReplaceSandboxOrder'))).toBe(false);
  });
});

describe('единицы цены в выводе (пункты vs рубли)', () => {
  it('предпросмотр облигации: пункты + ₽-эквивалент + предупреждение о заниженной оценке', async () => {
    const { api } = makeApi(
      {
        'SandboxService/GetSandboxMaxLots': { currency: 'rub', buyLimits: { buyMaxLots: '18' } },
        'SandboxService/GetSandboxOrderPrice': {
          totalOrderAmount: { currency: 'rub', units: '103', nano: 970000000 },
        },
      },
      BOND_INSTRUMENT,
    );
    const view = await previewOrder(api, {
      mode: 'sandbox',
      query: 'RU000A10B214',
      lots: 1,
      direction: 'buy',
      limitPrice: 100.5,
    });
    expect(view.priceUnit).toBe('point');
    expect(view.nominalRub).toBe(1000);
    const text = renderOrderPreview(view);
    expect(text).toContain('100.50 пт (≈ 1 005.00 ₽/шт)');
    expect(text).toMatch(/занижена/); // предупреждение об оценке суммы для облигаций
  });

  it('предпросмотр акции: цена в валюте (₽), без пунктов и без предупреждения', async () => {
    const { api } = makeApi({
      'SandboxService/GetSandboxMaxLots': { currency: 'rub', buyLimits: { buyMaxLots: '3' } },
      'SandboxService/GetSandboxOrderPrice': { totalOrderAmount: { currency: 'rub', units: '3003', nano: 0 } },
    });
    const view = await previewOrder(api, {
      mode: 'sandbox',
      query: 'SBER',
      lots: 1,
      direction: 'buy',
      limitPrice: 300.5,
    });
    expect(view.priceUnit).toBe('currency');
    const text = renderOrderPreview(view);
    expect(text).toContain('300.50 ₽');
    expect(text).not.toContain('пт');
    expect(text).not.toMatch(/занижена/);
  });

  it('покупка облигации: сумма висящей заявки в пунктах помечается «пт», не рублями', async () => {
    const { api } = makeApi(
      {
        'SandboxService/PostSandboxOrder': {
          orderId: 'srv-b2',
          executionReportStatus: 'EXECUTION_REPORT_STATUS_NEW',
          // Ещё не исполнена → API отдаёт сумму в пунктах (currency "pt.").
          totalOrderAmount: { currency: 'pt.', units: '100', nano: 500000000 },
        },
      },
      BOND_INSTRUMENT,
    );
    const view = await placeOrder(api, {
      mode: 'sandbox',
      query: 'RU000A10B214',
      lots: 1,
      direction: 'buy',
      limitPrice: 100.5,
      confirm: false,
      tradingGate: GATE_OFF,
    });
    expect(view.priceUnit).toBe('point');
    expect(view.nominalRub).toBe(1000);
    expect(renderPlacedOrder(view)).toContain('100.50 пт');
  });

  it('стоп по облигации: стоп-цена в пунктах с ₽-эквивалентом', async () => {
    const { api } = makeApi({ 'SandboxService/PostSandboxStopOrder': { stopOrderId: 'stop-b2' } }, BOND_INSTRUMENT);
    const view = await placeStopOrder(api, {
      mode: 'sandbox',
      query: 'RU000A10B214',
      lots: 1,
      kind: 'stop-loss',
      direction: 'sell',
      stopPrice: 99.5,
      limitPrice: null,
      confirm: false,
      tradingGate: GATE_OFF,
    });
    expect(view.priceUnit).toBe('point');
    expect(renderPlacedStopOrder(view)).toContain('99.50 пт (≈ 995.00 ₽/шт)');
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
