/**
 * Тесты команды income: сборка календаря купонов и дивидендов, месячные
 * итоги, предупреждения о неизвестных купонах и валютных выплатах.
 */
import { describe, expect, it } from 'vitest';
import type { BondCoupon, DividendItem, PortfolioPosition } from '../api/types.js';
import { buildIncomeView } from './income.js';

const now = new Date('2026-07-02T00:00:00Z');

const bondPosition: PortfolioPosition = {
  figi: 'figi-bond',
  instrumentUid: 'uid-bond',
  instrumentType: 'bond',
  ticker: 'RU000A1',
  quantity: { units: '10', nano: 0 },
};

const sharePosition: PortfolioPosition = {
  figi: 'figi-share',
  instrumentUid: 'uid-share',
  instrumentType: 'share',
  ticker: 'SBER',
  quantity: { units: '20', nano: 0 },
};

const coupon = (date: string, amount: number | null): BondCoupon => ({
  couponDate: date,
  ...(amount !== null ? { payOneBond: { currency: 'rub', units: String(Math.trunc(amount)), nano: Math.round((amount % 1) * 1e9) } } : {}),
});

const dividend = (paymentDate: string, amount: number, currency = 'rub'): DividendItem => ({
  paymentDate,
  dividendNet: { currency, units: String(Math.trunc(amount)), nano: Math.round((amount % 1) * 1e9) },
  dividendType: 'Regular Cash',
});

function build(params: {
  couponsByUid?: Map<string, BondCoupon[]>;
  dividendsByUid?: Map<string, DividendItem[]>;
}) {
  return buildIncomeView({
    accountId: 'acc-1',
    from: '2026-07-02T00:00:00.000Z',
    to: '2027-07-02T00:00:00.000Z',
    positions: [bondPosition, sharePosition],
    namesByUid: new Map([
      ['uid-bond', 'Тестовая облигация'],
      ['uid-share', 'Сбер Банк'],
    ]),
    couponsByUid: params.couponsByUid ?? new Map(),
    dividendsByUid: params.dividendsByUid ?? new Map(),
    now,
  });
}

describe('buildIncomeView', () => {
  it('собирает купоны и дивиденды в единый календарь с итогами по месяцам', () => {
    const view = build({
      couponsByUid: new Map([
        ['uid-bond', [coupon('2026-08-15T00:00:00Z', 20.5), coupon('2026-11-15T00:00:00Z', 20.5)]],
      ]),
      dividendsByUid: new Map([['uid-share', [dividend('2026-08-20T00:00:00Z', 15)]]]),
    });

    // 3 события в хронологическом порядке.
    expect(view.events.map((e) => `${e.date}:${e.kind}`)).toEqual([
      '2026-08-15:coupon',
      '2026-08-20:dividend',
      '2026-11-15:coupon',
    ]);
    // Купон: 20.5 × 10 = 205; дивиденд: 15 × 20 = 300.
    expect(view.events[0]?.total).toBe(205);
    expect(view.events[1]?.total).toBe(300);
    expect(view.monthlyTotals).toEqual([
      { month: '2026-08', total: 505 },
      { month: '2026-11', total: 205 },
    ]);
    expect(view.horizonTotal).toBe(710);
    expect(view.events[0]?.name).toBe('Тестовая облигация');
  });

  it('купоны с необъявленной суммой не входят в календарь, но дают предупреждение', () => {
    const view = build({
      couponsByUid: new Map([
        ['uid-bond', [coupon('2026-08-15T00:00:00Z', 20.5), coupon('2027-02-15T00:00:00Z', null)]],
      ]),
    });
    expect(view.events).toHaveLength(1);
    expect(view.warnings.some((w) => w.includes('не объявлена'))).toBe(true);
  });

  it('валютные выплаты видны в событиях, но не входят в рублёвые итоги', () => {
    const view = build({
      dividendsByUid: new Map([['uid-share', [dividend('2026-09-01T00:00:00Z', 2, 'usd')]]]),
    });
    expect(view.events).toHaveLength(1);
    expect(view.horizonTotal).toBe(0);
    expect(view.warnings.some((w) => w.includes('usd'))).toBe(true);
  });

  it('отменённые и прошедшие дивиденды не попадают в календарь', () => {
    const view = build({
      dividendsByUid: new Map([
        [
          'uid-share',
          [
            { ...dividend('2026-09-01T00:00:00Z', 10), dividendType: 'Cancelled' },
            dividend('2026-05-01T00:00:00Z', 10), // уже выплачен (в прошлом)
          ],
        ],
      ]),
    });
    expect(view.events).toHaveLength(0);
  });
});
