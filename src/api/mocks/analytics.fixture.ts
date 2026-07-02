/**
 * Мок-фикстуры аналитических команд (bond, dividends, fundamentals, forecast).
 *
 * Экспорты:
 * - NOW_FIXTURE — «текущий момент» тестов (2026-07-01);
 * - findBondFixture / findFloaterFixture — поиск облигаций;
 * - fixedBondFixture, fixedBondCouponsFixture, bondPriceAtParFixture —
 *   классика с фиксированным купоном (номинал 1000, купон 80 ₽ раз в год);
 * - floaterBondFixture, floaterCouponsFixture, floaterPriceFixture —
 *   флоатер с неопределёнными будущими купонами;
 * - offerBondFixture, offerBondCouponsFixture — выпуск с офертой;
 * - dividendsResponseFixture, dividendsPriceFixture — дивидендная история;
 * - fundamentalsResponseFixture — фундаментальные показатели;
 * - forecastResponseFixture — прогнозы аналитиков.
 *
 * Все даты согласованы с NOW_FIXTURE, чтобы расчёты были детерминированными.
 */
import type {
  BondResponse,
  FindInstrumentResponse,
  GetAssetFundamentalsResponse,
  GetBondCouponsResponse,
  GetDividendsResponse,
  GetForecastResponse,
  GetLastPricesResponse,
  MoneyValue,
} from '../types.js';

export const NOW_FIXTURE = new Date('2026-07-01T00:00:00Z');

// Короткий конструктор денежного значения для читаемости фикстур.
function rub(units: number, nano = 0): MoneyValue {
  return { units: String(units), nano, currency: 'rub' };
}

// --- Облигация с фиксированным купоном (базовый счастливый путь) ---

export const findBondFixture: FindInstrumentResponse = {
  instruments: [
    {
      uid: 'uid-bond-fixed',
      figi: 'TCS00A10TEST',
      ticker: 'RU000A10TEST',
      classCode: 'TQCB',
      isin: 'RU000A10TEST',
      instrumentType: 'bond',
      name: 'Тест-Завод 001Р-01',
      lot: 1,
    },
  ],
};

export const fixedBondFixture: BondResponse = {
  instrument: {
    uid: 'uid-bond-fixed',
    figi: 'TCS00A10TEST',
    ticker: 'RU000A10TEST',
    classCode: 'TQCB',
    isin: 'RU000A10TEST',
    name: 'Тест-Завод 001Р-01',
    currency: 'rub',
    sector: 'industrials',
    couponQuantityPerYear: 1,
    maturityDate: '2028-07-01T00:00:00Z',
    nominal: rub(1000),
    aciValue: rub(0),
    riskLevel: 'RISK_LEVEL_MODERATE',
    liquidityFlag: true,
  },
};

// Два годовых купона по 80 ₽: при цене 100% номинала эффективная
// доходность к погашению равна ставке купона — ровно 8%.
export const fixedBondCouponsFixture: GetBondCouponsResponse = {
  events: [
    { couponDate: '2025-07-01T00:00:00Z', payOneBond: rub(80), couponType: 'COUPON_TYPE_FIX' },
    { couponDate: '2027-07-01T00:00:00Z', payOneBond: rub(80), couponType: 'COUPON_TYPE_FIX' },
    { couponDate: '2028-07-01T00:00:00Z', payOneBond: rub(80), couponType: 'COUPON_TYPE_FIX' },
  ],
};

export const bondPriceAtParFixture: GetLastPricesResponse = {
  lastPrices: [
    {
      figi: 'TCS00A10TEST',
      instrumentUid: 'uid-bond-fixed',
      price: { units: '100', nano: 0 }, // облигации котируются в % номинала
      time: '2026-07-01T09:00:00Z',
    },
  ],
};

// --- Флоатер: будущие купоны ещё не определены ---

export const findFloaterFixture: FindInstrumentResponse = {
  instruments: [
    {
      uid: 'uid-bond-floater',
      figi: 'TCS00A10FLTR',
      ticker: 'RU000A10FLTR',
      classCode: 'TQCB',
      isin: 'RU000A10FLTR',
      instrumentType: 'bond',
      name: 'Тест-Флоатер 002Р-01',
      lot: 1,
    },
  ],
};

export const floaterBondFixture: BondResponse = {
  instrument: {
    uid: 'uid-bond-floater',
    figi: 'TCS00A10FLTR',
    ticker: 'RU000A10FLTR',
    classCode: 'TQCB',
    isin: 'RU000A10FLTR',
    name: 'Тест-Флоатер 002Р-01',
    currency: 'rub',
    couponQuantityPerYear: 4,
    maturityDate: '2028-05-18T00:00:00Z',
    nominal: rub(1000),
    aciValue: rub(19, 410_000_000),
    floatingCouponFlag: true,
  },
};

// Прошедший купон известен (42.86 ₽), будущие — без payOneBond:
// протобуф-шлюз просто опускает незаполненное поле.
export const floaterCouponsFixture: GetBondCouponsResponse = {
  events: [
    {
      couponDate: '2026-05-20T00:00:00Z',
      payOneBond: rub(42, 860_000_000),
      couponType: 'COUPON_TYPE_FLOATING',
    },
    { couponDate: '2026-08-20T00:00:00Z', couponType: 'COUPON_TYPE_FLOATING' },
    { couponDate: '2026-11-20T00:00:00Z', couponType: 'COUPON_TYPE_FLOATING' },
  ],
};

export const floaterPriceFixture: GetLastPricesResponse = {
  lastPrices: [
    {
      figi: 'TCS00A10FLTR',
      instrumentUid: 'uid-bond-floater',
      price: { units: '90', nano: 480_000_000 },
      time: '2026-07-01T09:00:00Z',
    },
  ],
};

// --- Выпуск с офертой: купоны известны только до callDate ---

export const offerBondFixture: BondResponse = {
  instrument: {
    ...fixedBondFixture.instrument,
    callDate: '2027-07-01T00:00:00Z',
  },
};

export const offerBondCouponsFixture: GetBondCouponsResponse = {
  events: [
    { couponDate: '2027-07-01T00:00:00Z', payOneBond: rub(80), couponType: 'COUPON_TYPE_FIX' },
    // Купон после оферты эмитент ещё не объявил.
    { couponDate: '2028-07-01T00:00:00Z', couponType: 'COUPON_TYPE_FIX' },
  ],
};

// --- Дивиденды (акция, цена 300 ₽) ---

export const findShareFixture: FindInstrumentResponse = {
  instruments: [
    {
      uid: 'uid-share',
      figi: 'BBG004TEST',
      ticker: 'TSTR',
      classCode: 'TQBR',
      isin: 'RU000TEST123',
      instrumentType: 'share',
      name: 'Тест-Ритейл',
      lot: 10,
      currency: 'rub',
    },
  ],
};

export const sharePriceFixture: GetLastPricesResponse = {
  lastPrices: [
    {
      figi: 'BBG004TEST',
      instrumentUid: 'uid-share',
      price: { units: '300', nano: 0 },
      time: '2026-07-01T09:00:00Z',
    },
  ],
};

export const dividendsResponseFixture: GetDividendsResponse = {
  dividends: [
    // Будущая объявленная выплата — попадает в upcoming.
    {
      dividendNet: rub(36, 500_000_000),
      recordDate: '2026-07-17T00:00:00Z',
      lastBuyDate: '2026-07-15T00:00:00Z',
      paymentDate: '2026-07-30T00:00:00Z',
      dividendType: 'Regular Cash',
      regularity: 'Annual',
      yieldValue: { units: '12', nano: 170_000_000 },
    },
    // Выплата в пределах последних 12 месяцев — входит в TTM.
    {
      dividendNet: rub(33, 0),
      recordDate: '2025-07-10T00:00:00Z',
      paymentDate: '2025-07-24T00:00:00Z',
      dividendType: 'Regular Cash',
      regularity: 'Annual',
      yieldValue: { units: '11', nano: 0 },
    },
    // Старая выплата — только в истории.
    {
      dividendNet: rub(30, 0),
      recordDate: '2024-07-11T00:00:00Z',
      paymentDate: '2024-07-25T00:00:00Z',
      dividendType: 'Regular Cash',
      regularity: 'Annual',
      yieldValue: { units: '10', nano: 500_000_000 },
    },
  ],
};

// --- Фундаментальные показатели ---

export const fundamentalsResponseFixture: GetAssetFundamentalsResponse = {
  fundamentals: [
    {
      assetUid: 'asset-uid-share',
      currency: 'rub',
      marketCapitalization: 6_800_000_000_000,
      peRatioTtm: 4.5,
      priceToBookTtm: 0.9,
      evToEbitdaMrq: 3.2,
      roe: 22.5,
      netMarginMrq: 32.1,
      totalDebtToEbitdaMrq: 1.1,
      dividendYieldDailyTtm: 11.2,
      forwardAnnualDividendYield: 12.4,
      dividendPayoutRatioFy: 50,
      highPriceLast52Weeks: 330,
      lowPriceLast52Weeks: 240,
      beta: 1.05,
      freeFloat: 48,
      epsTtm: 66.5,
      oneYearAnnualRevenueGrowthRate: 9.8,
    },
  ],
};

// --- Прогнозы аналитиков ---

export const forecastResponseFixture: GetForecastResponse = {
  targets: [
    {
      company: 'Дом-Аналитик',
      recommendation: 'RECOMMENDATION_BUY',
      recommendationDate: '2026-06-20T00:00:00Z',
      currency: 'rub',
      targetPrice: { units: '380', nano: 0 },
      priceChangeRel: { units: '26', nano: 670_000_000 },
    },
    {
      company: 'Брокер-Икс',
      recommendation: 'RECOMMENDATION_HOLD',
      recommendationDate: '2026-05-11T00:00:00Z',
      currency: 'rub',
      targetPrice: { units: '320', nano: 0 },
      priceChangeRel: { units: '6', nano: 670_000_000 },
    },
  ],
  consensus: {
    ticker: 'TSTR',
    recommendation: 'RECOMMENDATION_BUY',
    currency: 'rub',
    currentPrice: { units: '300', nano: 0 },
    consensus: { units: '350', nano: 0 },
    minTarget: { units: '320', nano: 0 },
    maxTarget: { units: '380', nano: 0 },
    priceChangeRel: { units: '16', nano: 670_000_000 },
  },
};
