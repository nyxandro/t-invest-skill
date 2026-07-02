/**
 * Финансовая математика облигаций (чистые функции, без обращений к API).
 *
 * Экспорты:
 * - BondCashFlow — денежный поток {date, amount};
 * - computeEffectiveYtmPercent(flows, dirtyPrice, settlement) — эффективная
 *   годовая доходность к погашению (XIRR-подход, ACT/365), %;
 * - computeMacaulayDurationYears(flows, ytmPercent, settlement) — дюрация
 *   Маколея в годах;
 * - computeCurrentCouponYieldPercent(annualCoupon, cleanPrice) — текущая
 *   купонная доходность, %.
 *
 * Политика no-fallbacks: при неполных данных (нет будущих потоков, нет цены)
 * функции возвращают null — вызывающий код обязан показать «данных нет»,
 * а не ноль.
 */

export interface BondCashFlow {
  date: Date;
  amount: number; // выплата в валюте номинала (купон или погашение)
}

// ACT/365: год считаем как 365 дней — стандарт котирования доходности на МосБирже.
const MS_PER_YEAR = 365 * 24 * 3600 * 1000;

// Границы и точность бисекции: доходности за пределами (-90%, +1000%)
// для торгуемых облигаций не встречаются, а если NPV не меняет знак на
// этом интервале — данные некорректны и честный ответ null.
const YTM_RATE_MIN = -0.9;
const YTM_RATE_MAX = 10;
const YTM_TOLERANCE = 1e-10;
const YTM_MAX_ITERATIONS = 200;

// Приведённая стоимость будущих потоков при эффективной годовой ставке rate.
function presentValue(flows: BondCashFlow[], rate: number, settlement: Date): number {
  return flows.reduce((sum, flow) => {
    const years = (flow.date.getTime() - settlement.getTime()) / MS_PER_YEAR;
    return sum + flow.amount / Math.pow(1 + rate, years);
  }, 0);
}

// Будущие потоки с положительной суммой — единственные, что участвуют в расчётах.
function futureFlows(flows: BondCashFlow[], settlement: Date): BondCashFlow[] {
  return flows.filter((f) => f.date.getTime() > settlement.getTime() && f.amount > 0);
}

export function computeEffectiveYtmPercent(
  flows: BondCashFlow[],
  dirtyPrice: number,
  settlement: Date,
): number | null {
  // dirtyPrice — полная цена покупки (чистая цена + НКД): именно столько
  // денег инвестор отдаёт сегодня, поэтому дисконтируем к ней.
  if (!(dirtyPrice > 0)) {
    return null;
  }
  const future = futureFlows(flows, settlement);
  if (future.length === 0) {
    return null;
  }

  // NPV(r) = PV(потоки, r) − цена монотонно убывает по r, поэтому бисекция
  // сходится всегда, если корень внутри интервала.
  let low = YTM_RATE_MIN;
  let high = YTM_RATE_MAX;
  const npvAt = (rate: number): number => presentValue(future, rate, settlement) - dirtyPrice;
  if (npvAt(low) < 0 || npvAt(high) > 0) {
    // Корень вне разумного диапазона доходностей — вероятно, битые данные.
    return null;
  }
  for (let i = 0; i < YTM_MAX_ITERATIONS && high - low > YTM_TOLERANCE; i += 1) {
    const mid = (low + high) / 2;
    if (npvAt(mid) > 0) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return ((low + high) / 2) * 100;
}

export function computeMacaulayDurationYears(
  flows: BondCashFlow[],
  ytmPercent: number,
  settlement: Date,
): number | null {
  const future = futureFlows(flows, settlement);
  if (future.length === 0) {
    return null;
  }
  const rate = ytmPercent / 100;

  // Дюрация Маколея: средневзвешенный срок потоков, веса — их приведённая стоимость.
  let weightedYears = 0;
  let totalPv = 0;
  for (const flow of future) {
    const years = (flow.date.getTime() - settlement.getTime()) / MS_PER_YEAR;
    const pv = flow.amount / Math.pow(1 + rate, years);
    weightedYears += years * pv;
    totalPv += pv;
  }
  if (totalPv <= 0) {
    return null;
  }
  return weightedYears / totalPv;
}

export function computeCurrentCouponYieldPercent(
  annualCouponAmount: number | null,
  cleanPrice: number,
): number | null {
  // Текущая купонная доходность — годовой купон к чистой цене покупки.
  // Показывает «зарплатную» составляющую без эффекта переоценки к номиналу.
  if (annualCouponAmount === null || !(annualCouponAmount > 0) || !(cleanPrice > 0)) {
    return null;
  }
  return (annualCouponAmount / cleanPrice) * 100;
}
