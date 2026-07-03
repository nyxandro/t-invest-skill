/**
 * Тесты bond-math: эффективная доходность к погашению (XIRR-подход),
 * текущая купонная доходность и дюрация Маколея.
 *
 * Контрольные значения посчитаны вручную по формуле сложного процента
 * (ACT/365), а не «подгонкой под реализацию».
 */
import { describe, expect, it } from 'vitest';
import {
  computeCurrentCouponYieldPercent,
  computeEffectiveYtmPercent,
  computeMacaulayDurationYears,
  couponAmount,
  type BondCashFlow,
} from './bond-math.js';
import type { BondCoupon } from '../api/types.js';

// Точка отсчёта всех тестов: покупка 1 января 2026 (UTC).
const SETTLEMENT = new Date('2026-01-01T00:00:00Z');

// Смещение от даты покупки на целое число лет ACT/365 — чтобы степени
// дисконтирования в контрольных расчётах были круглыми.
function yearsLater(years: number): Date {
  return new Date(SETTLEMENT.getTime() + years * 365 * 24 * 3600 * 1000);
}

describe('computeEffectiveYtmPercent', () => {
  it('бескупонная облигация: цена 900, номинал 1000 через год → ~11.11%', () => {
    const flows: BondCashFlow[] = [{ date: yearsLater(1), amount: 1000 }];
    const ytm = computeEffectiveYtmPercent(flows, 900, SETTLEMENT);
    // (1000 / 900) - 1 = 0.111111…
    expect(ytm).not.toBeNull();
    expect(ytm!).toBeCloseTo(11.1111, 3);
  });

  it('купонная облигация по номиналу: купон 80 ежегодно, 2 года → 8%', () => {
    const flows: BondCashFlow[] = [
      { date: yearsLater(1), amount: 80 },
      { date: yearsLater(2), amount: 1080 },
    ];
    const ytm = computeEffectiveYtmPercent(flows, 1000, SETTLEMENT);
    expect(ytm).not.toBeNull();
    expect(ytm!).toBeCloseTo(8, 4);
  });

  it('покупка дешевле номинала повышает доходность относительно купона', () => {
    const flows: BondCashFlow[] = [
      { date: yearsLater(1), amount: 80 },
      { date: yearsLater(2), amount: 1080 },
    ];
    const ytm = computeEffectiveYtmPercent(flows, 950, SETTLEMENT);
    expect(ytm).not.toBeNull();
    expect(ytm!).toBeGreaterThan(8);
  });

  it('без будущих потоков возвращает null (нет данных — нет расчёта)', () => {
    expect(computeEffectiveYtmPercent([], 1000, SETTLEMENT)).toBeNull();
    // Потоки только в прошлом равносильны их отсутствию.
    const past: BondCashFlow[] = [{ date: yearsLater(-1), amount: 1000 }];
    expect(computeEffectiveYtmPercent(past, 1000, SETTLEMENT)).toBeNull();
  });

  it('нулевая или отрицательная цена → null', () => {
    const flows: BondCashFlow[] = [{ date: yearsLater(1), amount: 1000 }];
    expect(computeEffectiveYtmPercent(flows, 0, SETTLEMENT)).toBeNull();
    expect(computeEffectiveYtmPercent(flows, -10, SETTLEMENT)).toBeNull();
  });
});

describe('computeMacaulayDurationYears', () => {
  it('у бескупонной облигации дюрация равна сроку до погашения', () => {
    const flows: BondCashFlow[] = [{ date: yearsLater(3), amount: 1000 }];
    const duration = computeMacaulayDurationYears(flows, 11.1111, SETTLEMENT);
    expect(duration).not.toBeNull();
    expect(duration!).toBeCloseTo(3, 4);
  });

  it('у купонной облигации дюрация короче срока до погашения', () => {
    const flows: BondCashFlow[] = [
      { date: yearsLater(1), amount: 80 },
      { date: yearsLater(2), amount: 1080 },
    ];
    const duration = computeMacaulayDurationYears(flows, 8, SETTLEMENT);
    expect(duration).not.toBeNull();
    expect(duration!).toBeLessThan(2);
    expect(duration!).toBeGreaterThan(1.8);
  });

  it('без будущих потоков → null', () => {
    expect(computeMacaulayDurationYears([], 8, SETTLEMENT)).toBeNull();
  });
});

describe('computeCurrentCouponYieldPercent', () => {
  it('годовой купон 165 ₽ при цене 1006 ₽ → ~16.4%', () => {
    const value = computeCurrentCouponYieldPercent(165, 1006);
    expect(value).not.toBeNull();
    expect(value!).toBeCloseTo(16.4016, 3);
  });

  it('нулевая цена или купон без значения → null', () => {
    expect(computeCurrentCouponYieldPercent(165, 0)).toBeNull();
    expect(computeCurrentCouponYieldPercent(null, 1006)).toBeNull();
  });
});

describe('couponAmount', () => {
  const coupon = (payOneBond?: BondCoupon['payOneBond']): BondCoupon => ({
    couponDate: '2026-06-01T00:00:00Z',
    ...(payOneBond ? { payOneBond } : {}),
  });

  it('возвращает выплату на облигацию, когда payOneBond задан', () => {
    expect(couponAmount(coupon({ currency: 'rub', units: '34', nano: 500000000 }))).toBe(34.5);
  });

  it('возвращает null, когда payOneBond опущен (protobuf опускает незаполненное = купон не объявлен)', () => {
    expect(couponAmount(coupon())).toBeNull();
  });

  it('трактует нулевой купон как «не объявлен» (null), а не как 0', () => {
    expect(couponAmount(coupon({ currency: 'rub', units: '0', nano: 0 }))).toBeNull();
  });
});
