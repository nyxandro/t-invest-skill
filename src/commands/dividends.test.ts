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

  it('дивиденды в USD при рублёвой цене — доходность не считается, есть предупреждение', async () => {
    // ГДР-подобный кейс: выплата в USD в пределах TTM-окна, а котировка
    // инструмента (findShareFixture) — в рублях. Сумму выплат посчитать можно
    // (валюты выплат между собой единообразны), но доходность к рублёвой цене —
    // нет: делить USD на RUB без курса нельзя (K6, no-fallbacks).
    const usdDividends = {
      dividends: [
        {
          dividendNet: { units: '2', nano: 0, currency: 'usd' },
          recordDate: '2025-07-10T00:00:00Z',
          paymentDate: '2025-07-24T00:00:00Z',
          dividendType: 'Regular Cash',
          regularity: 'Annual',
        },
      ],
    };
    const view = await fetchDividends(
      apiWith({ getDividends: async () => usdDividends }),
      'TSTR',
      NOW_FIXTURE,
    );

    expect(view.ttmSum).toBeCloseTo(2, 6);
    // Доходность не рассчитана из-за расхождения валют.
    expect(view.ttmYieldPercent).toBeNull();
    expect(view.warnings.some((w) => w.includes('USD') && w.includes('RUB'))).toBe(true);
  });

  it('дивиденды и цена в одной валюте — предупреждения о валютах нет', async () => {
    // Базовый рублёвый кейс не должен ложно срабатывать на расхождение валют.
    const view = await fetchDividends(apiWith(), 'TSTR', NOW_FIXTURE);
    expect(view.warnings).toHaveLength(0);
    expect(view.ttmYieldPercent).toBeCloseTo(11, 4);
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
