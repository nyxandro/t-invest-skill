/**
 * Команда bond: полная карточка облигации с расчётом доходностей.
 *
 * Экспорты:
 * - BondApi — контракт клиента для команды;
 * - BondCouponView, BondView — представление карточки;
 * - fetchBond(api, query, now) — сбор данных и расчёт метрик;
 * - renderBond(view) — человекочитаемый вывод.
 *
 * Что считаем и почему:
 * - T-Invest API не отдаёт готовую доходность к погашению — она вычисляется
 *   здесь из графика купонов, цены (в % номинала), НКД и номинала;
 * - для флоатеров/амортизации/бессрочных YTM честно равна null с русским
 *   предупреждением (no-fallbacks: не выдумываем то, чего нет в данных);
 * - при наличии оферты (callDate) доходность дополнительно считается
 *   к оферте — купон после оферты эмитент может изменить.
 */
import { moneyToNumber, quotationToNumber } from '../api/money.js';
import type {
  BondCoupon,
  BondResponse,
  GetBondCouponsResponse,
  GetLastPricesResponse,
} from '../api/types.js';
import { renderTable } from '../format/table.js';
import {
  computeCurrentCouponYieldPercent,
  computeEffectiveYtmPercent,
  computeMacaulayDurationYears,
  type BondCashFlow,
} from './bond-math.js';
import { resolveInstrument, type InstrumentSearchApi } from './resolve-instrument.js';

export interface BondApi extends InstrumentSearchApi {
  getBondBy(uid: string): Promise<BondResponse>;
  getBondCoupons(instrumentId: string, from: string, to: string): Promise<GetBondCouponsResponse>;
  getLastPrices(instrumentIds: string[]): Promise<GetLastPricesResponse>;
}

export interface BondCouponView {
  date: string;
  amount: number | null; // null — купон ещё не определён (типично для флоатера)
  type: string | null;
}

export interface BondView {
  ticker: string;
  isin: string | null;
  name: string;
  currency: string;
  uid: string;
  nominal: number | null;
  pricePercent: number | null; // котировка в % номинала
  priceRub: number | null; // чистая цена в валюте номинала
  nkd: number | null; // накопленный купонный доход
  dirtyPriceRub: number | null; // полная цена покупки (чистая + НКД)
  maturityDate: string | null;
  yearsToMaturity: number | null;
  offerDate: string | null;
  couponQuantityPerYear: number | null;
  nextCoupon: BondCouponView | null;
  annualCouponRub: number | null; // купонные выплаты за ближайший год
  currentCouponYieldPercent: number | null;
  ytmPercent: number | null; // эффективная доходность к погашению
  ytmToOfferPercent: number | null; // доходность к оферте (если есть callDate)
  macaulayDurationYears: number | null;
  floatingCoupon: boolean;
  amortization: boolean;
  perpetual: boolean;
  subordinated: boolean;
  replacedBond: boolean; // замещающая облигация
  forQualInvestor: boolean;
  riskLevel: string | null;
  futureCoupons: BondCouponView[];
  warnings: string[]; // русские предупреждения для пользователя
}

// В году 365 дней (ACT/365) — так же, как в bond-math.
const MS_PER_YEAR = 365 * 24 * 3600 * 1000;
// Горизонт «годового купона»: 366 дней покрывают високосные смещения дат выплат.
const ANNUAL_COUPON_WINDOW_DAYS = 366;
// Окно запроса графика купонов: год назад — чтобы знать последний выплаченный
// купон (ставка флоатера), горизонт вперёд — весь остаток жизни выпуска
// (для бессрочных — 30 лет, дальше купоны всё равно не объявлены).
const COUPON_LOOKBACK_DAYS = 366;
const COUPON_HORIZON_YEARS = 30;

// Сумма купона; null — выплата ещё не определена (protobuf опускает нули).
function couponAmount(coupon: BondCoupon): number | null {
  if (!coupon.payOneBond) {
    return null;
  }
  const value = moneyToNumber(coupon.payOneBond);
  return value > 0 ? value : null;
}

function toCouponView(coupon: BondCoupon): BondCouponView {
  return { date: coupon.couponDate, amount: couponAmount(coupon), type: coupon.couponType ?? null };
}

// Купонные выплаты за ближайший год: сумма ближайших 12 месяцев, если все
// они определены; иначе аннуализация ближайшего известного купона по частоте.
function estimateAnnualCoupon(
  future: BondCoupon[],
  lastKnown: BondCoupon | undefined,
  quantityPerYear: number | null,
  now: Date,
): number | null {
  const windowEnd = now.getTime() + ANNUAL_COUPON_WINDOW_DAYS * 24 * 3600 * 1000;
  const withinYear = future.filter((c) => new Date(c.couponDate).getTime() <= windowEnd);
  if (withinYear.length > 0 && withinYear.every((c) => couponAmount(c) !== null)) {
    return withinYear.reduce((sum, c) => sum + (couponAmount(c) ?? 0), 0);
  }
  // Будущие выплаты неизвестны (флоатер): берём последний известный купон.
  const reference = [...future].reverse().find((c) => couponAmount(c) !== null) ?? lastKnown;
  const referenceAmount = reference ? couponAmount(reference) : null;
  if (referenceAmount !== null && quantityPerYear !== null && quantityPerYear > 0) {
    return referenceAmount * quantityPerYear;
  }
  return null;
}

export async function fetchBond(api: BondApi, query: string, now: Date): Promise<BondView> {
  const resolved = await resolveInstrument(api, query, { instrumentType: 'bond' });

  // Карточку берём первой: дата погашения задаёт горизонт запроса купонов
  // (API без явного периода отдаёт только год вперёд и YTM занижается).
  const [{ instrument: bond }, pricesResponse] = await Promise.all([
    api.getBondBy(resolved.uid),
    api.getLastPrices([resolved.uid]),
  ]);
  const couponsFrom = new Date(now.getTime() - COUPON_LOOKBACK_DAYS * 24 * 3600 * 1000);
  const couponsTo = bond.maturityDate
    ? new Date(new Date(bond.maturityDate).getTime() + 24 * 3600 * 1000)
    : new Date(now.getTime() + COUPON_HORIZON_YEARS * MS_PER_YEAR);
  const couponsResponse = await api.getBondCoupons(
    resolved.uid,
    couponsFrom.toISOString(),
    couponsTo.toISOString(),
  );

  const warnings: string[] = [];
  const nominal = bond.nominal ? moneyToNumber(bond.nominal) : null;
  // НКД: отсутствие поля в protobuf-JSON означает ноль (сразу после выплаты
  // купона НКД действительно нулевой) — это не «данных нет».
  const nkd = bond.aciValue ? moneyToNumber(bond.aciValue) : 0;

  const lastPrice = pricesResponse.lastPrices.find((p) => p.instrumentUid === resolved.uid);
  const pricePercent = lastPrice?.price ? quotationToNumber(lastPrice.price) : null;
  if (pricePercent === null) {
    warnings.push('Нет текущей котировки — торги по выпуску сейчас не идут, ценовые метрики недоступны.');
  }
  const priceRub = pricePercent !== null && nominal !== null ? (pricePercent / 100) * nominal : null;
  const dirtyPriceRub = priceRub !== null ? priceRub + nkd : null;

  // График купонов: сортируем по дате, прошедшие нужны только как справка
  // о последней известной ставке (для флоатеров).
  const allCoupons = [...(couponsResponse.events ?? [])].sort(
    (a, b) => new Date(a.couponDate).getTime() - new Date(b.couponDate).getTime(),
  );
  const futureCoupons = allCoupons.filter((c) => new Date(c.couponDate).getTime() > now.getTime());
  const lastKnownPast = [...allCoupons]
    .reverse()
    .find((c) => new Date(c.couponDate).getTime() <= now.getTime() && couponAmount(c) !== null);

  const quantityPerYear = bond.couponQuantityPerYear ?? null;
  const annualCouponRub = estimateAnnualCoupon(futureCoupons, lastKnownPast, quantityPerYear, now);
  const currentCouponYieldPercent =
    priceRub !== null ? computeCurrentCouponYieldPercent(annualCouponRub, priceRub) : null;

  // Флаги выпуска и предупреждения по ним — до расчёта YTM, потому что
  // каждый из этих флагов делает расчёт к погашению некорректным.
  const floatingCoupon = Boolean(bond.floatingCouponFlag);
  const amortization = Boolean(bond.amortizationFlag);
  const perpetual = Boolean(bond.perpetualFlag);
  const subordinated = Boolean(bond.subordinatedFlag);
  if (floatingCoupon) {
    warnings.push(
      'Купон плавающий: размер будущих выплат зависит от ключевой ставки, доходность к погашению не рассчитывается.',
    );
  }
  if (amortization) {
    warnings.push('Номинал гасится частями (амортизация) — доходность к погашению не рассчитывается.');
  }
  if (perpetual) {
    warnings.push('Бессрочная облигация: номинал не погашается, метрика «к погашению» неприменима.');
  }
  if (subordinated) {
    warnings.push('Субординированный выпуск: повышенный риск списания при проблемах эмитента.');
  }
  if (bond.forQualInvestorFlag) {
    warnings.push('Выпуск доступен только квалифицированным инвесторам.');
  }
  if (bond.riskLevel === 'RISK_LEVEL_HIGH') {
    warnings.push('Биржа относит выпуск к высокому уровню риска.');
  }

  // Доходность к погашению: только при полном наборе честных данных —
  // цена, номинал, дата погашения и все будущие купоны определены.
  const allFutureKnown = futureCoupons.length > 0 && futureCoupons.every((c) => couponAmount(c) !== null);
  const canComputeYtm =
    !floatingCoupon &&
    !amortization &&
    !perpetual &&
    dirtyPriceRub !== null &&
    nominal !== null &&
    Boolean(bond.maturityDate);
  let ytmPercent: number | null = null;
  let macaulayDurationYears: number | null = null;
  if (canComputeYtm && allFutureKnown) {
    const flows: BondCashFlow[] = futureCoupons.map((c) => ({
      date: new Date(c.couponDate),
      amount: couponAmount(c) ?? 0,
    }));
    flows.push({ date: new Date(bond.maturityDate!), amount: nominal! });
    ytmPercent = computeEffectiveYtmPercent(flows, dirtyPriceRub!, now);
    if (ytmPercent !== null) {
      macaulayDurationYears = computeMacaulayDurationYears(flows, ytmPercent, now);
    }
  } else if (canComputeYtm && !allFutureKnown) {
    warnings.push('Часть будущих купонов ещё не определена эмитентом — доходность к погашению не рассчитывается.');
  }

  // Оферта: считаем доходность к дате оферты с выкупом по номиналу —
  // стандартное условие пут-оферт на российском рынке. Купон после оферты
  // может быть изменён, поэтому для бумаг с офертой это основная метрика.
  const offerDate = bond.callDate && new Date(bond.callDate).getTime() > now.getTime() ? bond.callDate : null;
  let ytmToOfferPercent: number | null = null;
  if (offerDate) {
    warnings.push(
      `По выпуску есть оферта ${offerDate.slice(0, 10)}: после неё эмитент может изменить купон — ориентируйтесь на доходность к оферте.`,
    );
    const offerTime = new Date(offerDate).getTime();
    const couponsToOffer = futureCoupons.filter((c) => new Date(c.couponDate).getTime() <= offerTime);
    const allKnownToOffer = couponsToOffer.every((c) => couponAmount(c) !== null);
    if (dirtyPriceRub !== null && nominal !== null && allKnownToOffer) {
      const flows: BondCashFlow[] = couponsToOffer.map((c) => ({
        date: new Date(c.couponDate),
        amount: couponAmount(c) ?? 0,
      }));
      flows.push({ date: new Date(offerDate), amount: nominal });
      ytmToOfferPercent = computeEffectiveYtmPercent(flows, dirtyPriceRub, now);
    }
  }

  const maturityDate = bond.maturityDate ?? null;
  return {
    ticker: resolved.ticker,
    isin: resolved.isin ?? bond.isin ?? null,
    name: bond.name,
    currency: bond.currency,
    uid: resolved.uid,
    nominal,
    pricePercent,
    priceRub,
    nkd,
    dirtyPriceRub,
    maturityDate,
    yearsToMaturity: maturityDate
      ? (new Date(maturityDate).getTime() - now.getTime()) / MS_PER_YEAR
      : null,
    offerDate,
    couponQuantityPerYear: quantityPerYear,
    nextCoupon: futureCoupons[0] ? toCouponView(futureCoupons[0]) : null,
    annualCouponRub,
    currentCouponYieldPercent,
    ytmPercent,
    ytmToOfferPercent,
    macaulayDurationYears,
    floatingCoupon,
    amortization,
    perpetual,
    subordinated,
    replacedBond: bond.bondType === 'BOND_TYPE_REPLACED',
    forQualInvestor: Boolean(bond.forQualInvestorFlag),
    riskLevel: bond.riskLevel ?? null,
    futureCoupons: futureCoupons.map(toCouponView),
    warnings,
  };
}

// Компактный ключ-значение: карточка читается сверху вниз, «—» = данных нет.
export function renderBond(view: BondView): string {
  const dash = '—';
  const pct = (v: number | null): string => (v !== null ? `${v.toFixed(2)}%` : dash);
  const money = (v: number | null): string => (v !== null ? `${v.toFixed(2)} ${view.currency}` : dash);
  const date = (v: string | null): string => (v !== null ? v.slice(0, 10) : dash);

  const lines = [
    `${view.name} (${view.ticker}${view.isin && view.isin !== view.ticker ? `, ${view.isin}` : ''})`,
    `Цена: ${pct(view.pricePercent)} номинала = ${money(view.priceRub)} + НКД ${money(view.nkd)}`,
    `Номинал: ${money(view.nominal)}  Погашение: ${date(view.maturityDate)}` +
      (view.yearsToMaturity !== null ? ` (через ${view.yearsToMaturity.toFixed(1)} г.)` : ''),
    `Купон: ${view.annualCouponRub !== null ? `${view.annualCouponRub.toFixed(2)} ${view.currency}/год` : dash}` +
      (view.couponQuantityPerYear !== null ? `, выплат в год: ${view.couponQuantityPerYear}` : ''),
    `Текущая купонная доходность: ${pct(view.currentCouponYieldPercent)}`,
    `Доходность к погашению (эффективная): ${pct(view.ytmPercent)}`,
    ...(view.offerDate !== null
      ? [`Оферта: ${date(view.offerDate)}, доходность к оферте: ${pct(view.ytmToOfferPercent)}`]
      : []),
    `Дюрация Маколея: ${
      view.macaulayDurationYears !== null ? `${view.macaulayDurationYears.toFixed(2)} г.` : dash
    }`,
  ];

  if (view.futureCoupons.length > 0) {
    lines.push('', 'Ближайшие купоны:');
    lines.push(
      renderTable(
        ['Дата', 'Выплата'],
        view.futureCoupons
          .slice(0, 8)
          .map((c) => [c.date.slice(0, 10), c.amount !== null ? c.amount.toFixed(2) : 'не определён']),
      ),
    );
  }
  if (view.warnings.length > 0) {
    lines.push('', ...view.warnings.map((w) => `⚠ ${w}`));
  }
  return lines.join('\n');
}
