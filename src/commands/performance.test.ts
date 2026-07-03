/**
 * Тесты команды performance: классификация операций, суммы вложений/выводов,
 * разбивка по корзинам, XIRR-свойство и предупреждения о пропусках.
 */
import { describe, expect, it } from 'vitest';
import type { OperationItem, PortfolioResponse } from '../api/types.js';
import {
  buildPerformanceView,
  classifyOperationType,
  fetchPerformance,
  type PerformanceApi,
} from './performance.js';

const rub = (amount: number): { currency: string; units: string; nano: number } => {
  const units = Math.trunc(amount);
  return { currency: 'rub', units: String(units), nano: Math.round((amount - units) * 1e9) };
};

const op = (id: string, date: string, type: string, payment: number, currency = 'rub'): OperationItem => ({
  id,
  date,
  type,
  payment: currency === 'rub' ? rub(payment) : { ...rub(payment), currency },
});

describe('classifyOperationType', () => {
  it('раскладывает типы по корзинам с правильным приоритетом', () => {
    expect(classifyOperationType('OPERATION_TYPE_INPUT')).toBe('input');
    expect(classifyOperationType('OPERATION_TYPE_OUTPUT')).toBe('output');
    expect(classifyOperationType('OPERATION_TYPE_DIVIDEND')).toBe('dividend');
    // Налог с дивидендов — налог, а не дивиденд (порядок проверок).
    expect(classifyOperationType('OPERATION_TYPE_DIVIDEND_TAX')).toBe('tax');
    expect(classifyOperationType('OPERATION_TYPE_COUPON')).toBe('coupon');
    expect(classifyOperationType('OPERATION_TYPE_BROKER_FEE')).toBe('commission');
    expect(classifyOperationType('OPERATION_TYPE_SERVICE_FEE')).toBe('commission');
    expect(classifyOperationType('OPERATION_TYPE_TAX')).toBe('tax');
    expect(classifyOperationType('OPERATION_TYPE_BUY')).toBe('trade');
    expect(classifyOperationType('OPERATION_TYPE_SELL')).toBe('trade');
    expect(classifyOperationType('OPERATION_TYPE_INPUT_SECURITIES')).toBe('securities-transfer');
    expect(classifyOperationType(null)).toBe('other');
  });
});

describe('buildPerformanceView', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const baseParams = {
    accountId: 'acc-1',
    from: '2025-01-01T00:00:00Z',
    to: '2026-01-01T00:00:00Z',
    now,
  };

  it('считает вложения, выводы, чистый результат и разбивку', () => {
    const items: OperationItem[] = [
      op('in-1', '2025-01-01T00:00:00Z', 'OPERATION_TYPE_INPUT', 100000),
      op('out-1', '2025-07-01T00:00:00Z', 'OPERATION_TYPE_OUTPUT', -20000),
      op('div-1', '2025-06-01T00:00:00Z', 'OPERATION_TYPE_DIVIDEND', 3000),
      op('coup-1', '2025-06-02T00:00:00Z', 'OPERATION_TYPE_COUPON', 1500),
      op('fee-1', '2025-06-03T00:00:00Z', 'OPERATION_TYPE_BROKER_FEE', -300),
      op('tax-1', '2025-06-04T00:00:00Z', 'OPERATION_TYPE_DIVIDEND_TAX', -390),
      op('buy-1', '2025-02-01T00:00:00Z', 'OPERATION_TYPE_BUY', -50000),
    ];
    const view = buildPerformanceView({ ...baseParams, items, currentValue: 95000 });

    expect(view.invested).toBe(100000);
    expect(view.withdrawn).toBe(20000);
    expect(view.currentValue).toBe(95000);
    // 95000 + 20000 - 100000 = 15000 прибыли.
    expect(view.netProfit).toBe(15000);
    expect(view.netProfitPercent).toBe(15);
    expect(view.breakdown).toEqual({
      dividends: 3000,
      coupons: 1500,
      commissions: -300,
      taxes: -390,
    });
    // XIRR существует и положителен (вложили 100, вернули 115 за год).
    expect(view.xirrPercent).not.toBeNull();
    expect(view.xirrPercent!).toBeGreaterThan(10);
    expect(view.xirrPercent!).toBeLessThan(25);
    expect(view.warnings).toEqual([]);
  });

  it('пропускает валютные операции с предупреждением', () => {
    const items: OperationItem[] = [
      op('in-1', '2025-01-01T00:00:00Z', 'OPERATION_TYPE_INPUT', 100000),
      op('in-usd', '2025-03-01T00:00:00Z', 'OPERATION_TYPE_INPUT', 1000, 'usd'),
    ];
    const view = buildPerformanceView({ ...baseParams, items, currentValue: 110000 });
    expect(view.invested).toBe(100000); // usd-пополнение не смешано с рублями
    expect(view.warnings.some((w) => w.includes('usd'))).toBe(true);
  });

  it('предупреждает о переводах бумаг (искажение XIRR)', () => {
    const items: OperationItem[] = [
      op('in-1', '2025-01-01T00:00:00Z', 'OPERATION_TYPE_INPUT', 100000),
      { id: 'sec-1', date: '2025-05-01T00:00:00Z', type: 'OPERATION_TYPE_INPUT_SECURITIES' },
    ];
    const view = buildPerformanceView({ ...baseParams, items, currentValue: 120000 });
    expect(view.warnings.some((w) => w.includes('перевод'))).toBe(true);
  });

  it('нулевая история: без потоков XIRR и процент прибыли равны null', () => {
    const view = buildPerformanceView({ ...baseParams, items: [], currentValue: 0 });
    expect(view.xirrPercent).toBeNull();
    expect(view.netProfitPercent).toBeNull();
    expect(view.netProfit).toBe(0);
  });

  // K18: денежную операцию без payment нельзя молча выкинуть (no-fallbacks для
  // денежных данных) — иначе invested/withdrawn/XIRR искажаются без сигнала.
  it('предупреждает о денежных операциях без суммы платежа (не теряем молча)', () => {
    const items: OperationItem[] = [
      op('in-1', '2025-01-01T00:00:00Z', 'OPERATION_TYPE_INPUT', 100000),
      // Исполненное пополнение без payment — денежные данные утеряны шлюзом.
      { id: 'in-broken', date: '2025-02-01T00:00:00Z', type: 'OPERATION_TYPE_INPUT' },
    ];
    const view = buildPerformanceView({ ...baseParams, items, currentValue: 110000 });
    expect(view.invested).toBe(100000); // сломанная операция не попала в суммы
    expect(view.warnings.some((w) => w.includes('без суммы платежа'))).toBe(true);
  });

  // Технические записи (bucket 'other') без payment — норма, не денежные данные:
  // предупреждать о них нельзя, иначе получим ложную тревогу на каждом отчёте.
  it('технические записи без суммы платежа не порождают предупреждение', () => {
    const items: OperationItem[] = [
      op('in-1', '2025-01-01T00:00:00Z', 'OPERATION_TYPE_INPUT', 100000),
      { id: 'tech-1', date: '2025-02-01T00:00:00Z', type: 'OPERATION_TYPE_OVERNIGHT' },
    ];
    const view = buildPerformanceView({ ...baseParams, items, currentValue: 110000 });
    expect(view.warnings.some((w) => w.includes('без суммы платежа'))).toBe(false);
  });
});

describe('fetchPerformance', () => {
  // K36: список счетов должен запрашиваться ровно один раз (resolveAccountId
  // и получение openedDate переиспользуют один ответ), а операции и портфель —
  // грузиться параллельно.
  it('запрашивает список счетов один раз и объединяет операции с портфелем', async () => {
    let getAccountsCalls = 0;
    const api: PerformanceApi = {
      getAccounts: async () => {
        getAccountsCalls += 1;
        return {
          accounts: [
            {
              id: 'acc-1',
              type: 'ACCOUNT_TYPE_TINKOFF',
              name: 'Брокерский',
              status: 'ACCOUNT_STATUS_OPEN',
              openedDate: '2025-01-01T00:00:00Z',
              accessLevel: 'ACCOUNT_ACCESS_LEVEL_FULL_ACCESS',
            },
          ],
        };
      },
      getOperationsByCursor: async () => ({
        hasNext: false,
        items: [op('in-1', '2025-01-01T00:00:00Z', 'OPERATION_TYPE_INPUT', 100000)],
      }),
      // В расчёте используется только totalAmountPortfolio — остальное не нужно.
      getPortfolio: async () =>
        ({ totalAmountPortfolio: rub(110000) }) as unknown as PortfolioResponse,
    };

    const view = await fetchPerformance(api, { now: new Date('2026-01-01T00:00:00Z') });

    expect(getAccountsCalls).toBe(1); // без дублирующего сетевого вызова
    expect(view.accountId).toBe('acc-1');
    expect(view.invested).toBe(100000);
    expect(view.currentValue).toBe(110000);
  });
});
