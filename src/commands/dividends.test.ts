/**
 * Тесты команды dividends: TTM-доходность, разделение история/объявленные,
 * фильтрация отменённых выплат, честный null при пустых данных.
 */
import { describe, expect, it } from 'vitest';
import {
  dividendsResponseFixture,
  findShareFixture,
  NOW_FIXTURE,
  sharePriceFixture,
} from '../api/mocks/analytics.fixture.js';
import { fetchDividends } from './dividends.js';

function apiWith(overrides: Partial<Parameters<typeof fetchDividends>[0]> = {}) {
  return {
    findInstrument: async () => findShareFixture,
    getDividends: async () => dividendsResponseFixture,
    getLastPrices: async () => sharePriceFixture,
    ...overrides,
  };
}

describe('fetchDividends', () => {
  it('делит выплаты на будущие и историю, считает TTM-доходность к цене', async () => {
    const view = await fetchDividends(apiWith(), 'TSTR', NOW_FIXTURE);

    expect(view.upcoming).toHaveLength(1);
    expect(view.upcoming[0]!.amount).toBeCloseTo(36.5, 6);
    expect(view.history).toHaveLength(2);
    // В TTM-окно (365 дней от 2026-07-01) попадает только выплата 33 ₽
    // с реестром 2025-07-10.
    expect(view.ttmSum).toBeCloseTo(33, 6);
    // 33 / 300 × 100 = 11%.
    expect(view.ttmYieldPercent).toBeCloseTo(11, 4);
  });

  it('отменённые выплаты не попадают ни в историю, ни в TTM', async () => {
    const withCancelled = {
      dividends: [
        ...(dividendsResponseFixture.dividends ?? []),
        {
          dividendNet: { units: '99', nano: 0, currency: 'rub' },
          recordDate: '2025-10-01T00:00:00Z',
          dividendType: 'Cancelled',
        },
      ],
    };
    const view = await fetchDividends(
      apiWith({ getDividends: async () => withCancelled }),
      'TSTR',
      NOW_FIXTURE,
    );

    expect(view.history).toHaveLength(2);
    expect(view.ttmSum).toBeCloseTo(33, 6);
  });

  it('пустая история — валидный ответ с нулём выплат и null-метриками', async () => {
    const view = await fetchDividends(
      apiWith({ getDividends: async () => ({}) }),
      'TSTR',
      NOW_FIXTURE,
    );

    expect(view.history).toHaveLength(0);
    expect(view.upcoming).toHaveLength(0);
    expect(view.ttmSum).toBeNull();
    expect(view.ttmYieldPercent).toBeNull();
  });
});
