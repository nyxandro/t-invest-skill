/**
 * XIRR — money-weighted годовая доходность по произвольным денежным потокам
 * (вложения отрицательные, возвраты и конечная стоимость положительные).
 *
 * Экспорты:
 * - CashFlow — денежный поток {date, amount};
 * - computeXirrPercent(flows) — эффективная годовая ставка в процентах,
 *   при которой NPV потоков равна нулю; null, если расчёт невозможен
 *   (нет разнознаковых потоков, нулевой горизонт, корень вне диапазона).
 *
 * Отличие от bond-math: там потоки строго положительные и цена отдельно
 * (NPV монотонна — хватает бисекции), здесь потоки разнознаковые, поэтому
 * сначала ищем смену знака NPV по сетке ставок, затем уточняем бисекцией.
 * Политика no-fallbacks: при сомнительных данных честный null, а не 0.
 */

export interface CashFlow {
  date: Date;
  amount: number;
}

// ACT/365 — тот же конвенционал, что и в bond-math.
const MS_PER_YEAR = 365 * 24 * 3600 * 1000;

// Сетка поиска смены знака NPV: от глубокого минуса (-99%) до +1000% годовых.
// Реальные доходности портфелей лежат глубоко внутри диапазона; выход корня
// за границы — признак битых данных, честный ответ null.
const RATE_GRID: readonly number[] = [
  -0.99, -0.95, -0.9, -0.8, -0.7, -0.6, -0.5, -0.4, -0.3, -0.2, -0.1, -0.05,
  0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10,
];
const XIRR_TOLERANCE = 1e-10;
const XIRR_MAX_ITERATIONS = 200;

// Горизонт короче суток аннуализировать бессмысленно — расчёт не выполняем.
const MIN_SPAN_MS = 24 * 3600 * 1000;

function npv(flows: CashFlow[], rate: number, t0: number): number {
  return flows.reduce((sum, flow) => {
    const years = (flow.date.getTime() - t0) / MS_PER_YEAR;
    return sum + flow.amount / Math.pow(1 + rate, years);
  }, 0);
}

export function computeXirrPercent(flows: CashFlow[]): number | null {
  // Для корня нужны и вложения (минус), и возвраты (плюс).
  const hasNegative = flows.some((f) => f.amount < 0);
  const hasPositive = flows.some((f) => f.amount > 0);
  if (flows.length < 2 || !hasNegative || !hasPositive) {
    return null;
  }

  const times = flows.map((f) => f.date.getTime());
  const t0 = Math.min(...times);
  if (Math.max(...times) - t0 < MIN_SPAN_MS) {
    return null;
  }

  // При многократной смене знака потоков (пополнения/выводы вперемешку)
  // у NPV несколько корней — классическая неоднозначность IRR. Экономически
  // осмысленный корень лежит на стороне, согласованной со знаком итога
  // (поведение Excel XIRR с ньютоновским стартом из +10%):
  // - NPV(0) > 0 (итог прибыльный) → наименьший ПОЛОЖИТЕЛЬНЫЙ корень;
  // - NPV(0) < 0 (итог убыточный) → отрицательный корень, ближайший к нулю.
  // Проверено на живом счёте: корень «первый слева» давал -85% при
  // фактической прибыли +65% к вложенному.
  const f = (rate: number): number => npv(flows, rate, t0);
  const profitable = f(0) >= 0;
  const zeroIndex = RATE_GRID.indexOf(0);
  let bracket: [number, number] | null = null;
  if (profitable) {
    // Идём от нулевой ставки вправо: первый интервал со сменой знака.
    for (let i = zeroIndex; i < RATE_GRID.length - 1 && !bracket; i += 1) {
      if (f(RATE_GRID[i]!) * f(RATE_GRID[i + 1]!) <= 0) {
        bracket = [RATE_GRID[i]!, RATE_GRID[i + 1]!];
      }
    }
  } else {
    // Идём от нулевой ставки влево: ближайший к нулю отрицательный корень.
    for (let i = zeroIndex; i > 0 && !bracket; i -= 1) {
      if (f(RATE_GRID[i - 1]!) * f(RATE_GRID[i]!) <= 0) {
        bracket = [RATE_GRID[i - 1]!, RATE_GRID[i]!];
      }
    }
  }
  if (!bracket) {
    return null;
  }

  // Бисекция внутри найденного интервала: знак NPV на концах различен.
  let [low, high] = bracket;
  let fLow = f(low);
  for (let i = 0; i < XIRR_MAX_ITERATIONS && high - low > XIRR_TOLERANCE; i += 1) {
    const mid = (low + high) / 2;
    const fMid = f(mid);
    if (fLow * fMid <= 0) {
      high = mid;
    } else {
      low = mid;
      fLow = fMid;
    }
  }
  return ((low + high) / 2) * 100;
}
