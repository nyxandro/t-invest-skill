/**
 * Тесты команды orderbook: лучшие цены, спред к середине, объёмы
 * и пустой стакан.
 */
import { describe, expect, it } from 'vitest';
import { buildOrderBookView } from './orderbook.js';

const q = (value: number): { units: string; nano: number } => ({
  units: String(Math.trunc(value)),
  nano: Math.round((value % 1) * 1e9),
});

describe('buildOrderBookView', () => {
  it('считает лучшие цены, спред и объёмы', () => {
    const view = buildOrderBookView({
      ticker: 'SBER',
      name: 'Сбер Банк',
      resp: {
        depth: 2,
        bids: [
          { price: q(99), quantity: '100' },
          { price: q(98.5), quantity: '50' },
        ],
        asks: [
          { price: q(101), quantity: '70' },
          { price: q(101.5), quantity: '30' },
        ],
        lastPrice: q(100),
      },
    });
    expect(view.bestBid).toBe(99);
    expect(view.bestAsk).toBe(101);
    // (101 - 99) / 100 × 100 = 2%.
    expect(view.spreadPercent).toBe(2);
    expect(view.bidVolume).toBe(150);
    expect(view.askVolume).toBe(100);
    expect(view.lastPrice).toBe(100);
  });

  it('пустой стакан — нули и null без исключений', () => {
    const view = buildOrderBookView({ ticker: 'X', name: 'X', resp: {} });
    expect(view.bestBid).toBeNull();
    expect(view.bestAsk).toBeNull();
    expect(view.spreadPercent).toBeNull();
    expect(view.bidVolume).toBe(0);
  });
});
