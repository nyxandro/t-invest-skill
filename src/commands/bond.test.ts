/**
 * Тесты команды bond: карточка облигации с расчётом доходностей,
 * честные null и предупреждения для флоатеров/оферт/отсутствующей цены.
 */
import { describe, expect, it } from 'vitest';
import {
  bondPriceAtParFixture,
  findBondFixture,
  findFloaterFixture,
  fixedBondCouponsFixture,
  fixedBondFixture,
  floaterBondFixture,
  floaterCouponsFixture,
  floaterPriceFixture,
  NOW_FIXTURE,
  offerBondCouponsFixture,
  offerBondFixture,
} from '../api/mocks/analytics.fixture.js';
import { fetchBond } from './bond.js';

// Стаб API облигаций: каждый метод отдаёт заданную фикстуру.
function apiWith(overrides: Partial<Parameters<typeof fetchBond>[0]> = {}) {
  return {
    findInstrument: async () => findBondFixture,
    getBondBy: async () => fixedBondFixture,
    getBondCoupons: async () => fixedBondCouponsFixture,
    getLastPrices: async () => bondPriceAtParFixture,
    ...overrides,
  };
}

describe('fetchBond', () => {
  it('фиксированный купон по номиналу: YTM ≈ ставке купона, без предупреждений о расчёте', async () => {
    const view = await fetchBond(apiWith(), 'RU000A10TEST', NOW_FIXTURE);

    expect(view.name).toBe('Тест-Завод 001Р-01');
    expect(view.nominal).toBe(1000);
    expect(view.pricePercent).toBe(100);
    expect(view.priceRub).toBe(1000);
    expect(view.floatingCoupon).toBe(false);
    // Купон 80 ₽ при цене 1000 ₽ — текущая доходность ровно 8%.
    expect(view.currentCouponYieldPercent).toBeCloseTo(8, 3);
    // Два будущих купона + номинал при цене 100% → эффективная YTM 8%.
    expect(view.ytmPercent).not.toBeNull();
    expect(view.ytmPercent!).toBeCloseTo(8, 1);
    expect(view.macaulayDurationYears).not.toBeNull();
    expect(view.futureCoupons).toHaveLength(2);
    expect(view.warnings).toHaveLength(0);
  });

  it('флоатер: YTM = null, предупреждение, текущая доходность по последнему купону', async () => {
    const view = await fetchBond(
      apiWith({
        findInstrument: async () => findFloaterFixture,
        getBondBy: async () => floaterBondFixture,
        getBondCoupons: async () => floaterCouponsFixture,
        getLastPrices: async () => floaterPriceFixture,
      }),
      'RU000A10FLTR',
      NOW_FIXTURE,
    );

    expect(view.floatingCoupon).toBe(true);
    expect(view.ytmPercent).toBeNull();
    // 42.86 ₽ × 4 раза в год к цене 904.8 ₽ ≈ 18.95% — аннуализация
    // последнего известного купона.
    expect(view.currentCouponYieldPercent).not.toBeNull();
    expect(view.currentCouponYieldPercent!).toBeCloseTo(18.95, 1);
    expect(view.warnings.join(' ')).toContain('плавающ');
  });

  it('оферта: доходность считается к оферте, о самой оферте — предупреждение', async () => {
    const view = await fetchBond(
      apiWith({
        getBondBy: async () => offerBondFixture,
        getBondCoupons: async () => offerBondCouponsFixture,
      }),
      'RU000A10TEST',
      NOW_FIXTURE,
    );

    expect(view.offerDate).toBe('2027-07-01T00:00:00Z');
    // Купон после оферты не определён → YTM к погашению честно null…
    expect(view.ytmPercent).toBeNull();
    // …а к оферте все потоки известны: купон 80 + номинал через год при
    // цене 100% ≈ 8%.
    expect(view.ytmToOfferPercent).not.toBeNull();
    expect(view.ytmToOfferPercent!).toBeCloseTo(8, 1);
    expect(view.warnings.join(' ')).toContain('оферт');
  });

  it('запрашивает купоны от прошлого года до даты погашения (регрессия: без явного окна API отдаёт только год вперёд)', async () => {
    let capturedFrom = '';
    let capturedTo = '';
    await fetchBond(
      apiWith({
        getBondCoupons: async (_id: string, from: string, to: string) => {
          capturedFrom = from;
          capturedTo = to;
          return fixedBondCouponsFixture;
        },
      }),
      'RU000A10TEST',
      NOW_FIXTURE,
    );

    // Окно обязано накрывать весь остаток жизни выпуска: от прошлого купона
    // (ставка флоатера) до погашения 2028-07-01 включительно.
    expect(new Date(capturedFrom).getTime()).toBeLessThan(NOW_FIXTURE.getTime());
    expect(new Date(capturedTo).getTime()).toBeGreaterThanOrEqual(
      new Date('2028-07-01T00:00:00Z').getTime(),
    );
  });

  it('нет котировки: ценовые метрики null + предупреждение, но карточка отдаётся', async () => {
    const view = await fetchBond(
      apiWith({ getLastPrices: async () => ({ lastPrices: [] }) }),
      'RU000A10TEST',
      NOW_FIXTURE,
    );

    expect(view.pricePercent).toBeNull();
    expect(view.priceRub).toBeNull();
    expect(view.ytmPercent).toBeNull();
    expect(view.currentCouponYieldPercent).toBeNull();
    // Некоторые данные всё равно полезны: номинал, купоны, даты.
    expect(view.nominal).toBe(1000);
    expect(view.warnings.join(' ')).toContain('котировк');
  });
});
