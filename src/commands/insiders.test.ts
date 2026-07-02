/**
 * Тесты команды insiders: маппинг сделок, направления, суммы и счётчики.
 */
import { describe, expect, it } from 'vitest';
import { buildInsidersView } from './insiders.js';

describe('buildInsidersView', () => {
  it('маппит сделки и считает покупки/продажи', () => {
    const view = buildInsidersView('GAZP', 'Газпром', [
      {
        tradeId: '1',
        direction: 'TRADE_DIRECTION_SELL',
        date: '2025-11-12T00:00:00Z',
        quantity: '111009',
        price: { units: '119', nano: 140000000 },
        investorName: 'Газпром',
        investorPosition: 'Эмитент',
        percentage: 4.7e-4,
        disclosureDate: '2025-11-13T00:00:00Z',
      },
      {
        tradeId: '2',
        direction: 'TRADE_DIRECTION_BUY',
        date: '2025-10-01T00:00:00Z',
        quantity: '100',
        price: { units: '120', nano: 0 },
      },
    ]);
    expect(view.buyCount).toBe(1);
    expect(view.sellCount).toBe(1);
    expect(view.deals[0]).toMatchObject({
      date: '2025-11-12',
      direction: 'sell',
      investorName: 'Газпром',
      quantity: 111009,
      price: 119.14,
      percentage: 4.7e-4,
      disclosureDate: '2025-11-13',
    });
    // Сумма сделки: 119.14 × 111009 ≈ 13 225 612.26.
    expect(view.deals[0]!.amount).toBeCloseTo(13225612.26, 0);
    // Отсутствие данных — null, не ноль.
    expect(view.deals[1]!.percentage).toBeNull();
  });

  it('пустой список сделок', () => {
    const view = buildInsidersView('X', 'X', []);
    expect(view.deals).toEqual([]);
    expect(view.buyCount).toBe(0);
  });
});
