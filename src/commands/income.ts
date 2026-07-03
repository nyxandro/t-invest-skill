/**
 * Команда income: календарь пассивного дохода портфеля — будущие купоны
 * облигаций и объявленные дивиденды акций/фондов на 12 месяцев вперёд.
 *
 * Экспорты:
 * - IncomeApi — контракт клиента;
 * - IncomeEventView — событие выплаты (купон/дивиденд) с суммой на позицию;
 * - buildIncomeView(params) — чистая сборка календаря (тестируется без API);
 * - fetchIncome(api, params) — загрузка портфеля + выплат + сборка;
 * - renderIncome(view) — человекочитаемый календарь.
 */
import { moneyToNumber, quotationToNumber, formatAmount, round } from '../api/money.js';
import type {
  BondCoupon,
  DividendItem,
  GetBondCouponsResponse,
  GetDividendsResponse,
  GetInstrumentByResponse,
  PortfolioPosition,
  PortfolioResponse,
} from '../api/types.js';
import { BATCH_CONCURRENCY, BATCH_MIN_INTERVAL_MS, INCOME_HORIZON_DAYS, MS_PER_DAY } from '../config/config.js';
// MOSCOW_OFFSET_MS — для расчёта начала московских суток (граница «прошлого»).
import { MOSCOW_OFFSET_MS } from '../format/datetime.js';
import { renderTable } from '../format/table.js';
import { mapWithConcurrency } from '../util/concurrency.js';
import { couponAmount } from './bond-math.js';
import { resolveAccountId, type AccountsApi } from './resolve-account.js';

export interface IncomeApi extends AccountsApi {
  getPortfolio(accountId: string): Promise<PortfolioResponse>;
  getInstrumentByUid(uid: string): Promise<GetInstrumentByResponse>;
  getBondCoupons(instrumentId: string, from: string, to: string): Promise<GetBondCouponsResponse>;
  getDividends(instrumentId: string, from: string, to: string): Promise<GetDividendsResponse>;
}

export interface IncomeEventView {
  date: string; // дата выплаты (ISO, до дня)
  ticker: string;
  name: string | null;
  kind: 'coupon' | 'dividend';
  perUnit: number; // выплата на одну бумагу
  quantity: number;
  total: number;
  currency: string;
}

export interface IncomeView {
  accountId: string;
  from: string;
  to: string;
  events: IncomeEventView[];
  monthlyTotals: { month: string; total: number }[]; // YYYY-MM, только rub
  horizonTotal: number; // сумма rub-выплат за горизонт
  warnings: string[];
}

// Начало текущих суток по московскому времени как UTC-момент. Ловушка API:
// даты выплат приходят UTC-полуночью, а пользователь и биржа живут по МСК —
// сравнение «прошлого» с интрадей-моментом now выкидывало СЕГОДНЯШНЮЮ выплату
// как уже состоявшуюся, и она выпадала из календаря и месячных итогов. Считаем
// нижнюю границу окна от начала московского дня, чтобы выплата с датой = сегодня
// (по МСК) попадала в расчёт.
function moscowDayStart(now: Date): Date {
  // Переносим момент в «настенные» координаты МСК, обнуляем время суток и
  // возвращаем обратно в UTC — получаем UTC-инстант московской полуночи.
  const shifted = new Date(now.getTime() + MOSCOW_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - MOSCOW_OFFSET_MS);
}

// Купоны позиции → события календаря. Будущие купоны флоатера без суммы —
// предупреждение, а не нулевые строки.
function couponEvents(
  position: PortfolioPosition,
  name: string | null,
  coupons: BondCoupon[],
  warnings: string[],
): IncomeEventView[] {
  const quantity = quotationToNumber(position.quantity);
  const ticker = position.ticker ?? position.figi;
  const events: IncomeEventView[] = [];
  let unknownCoupons = 0;
  for (const coupon of coupons) {
    // couponAmount вернёт null и для отсутствующего payOneBond, и для нулевой
    // суммы (необъявленный купон флоатера) — единый хелпер вместо inline-проверки.
    const perUnit = couponAmount(coupon);
    if (perUnit === null) {
      unknownCoupons += 1; // сумма ещё не объявлена (типично для флоатеров)
      continue;
    }
    events.push({
      date: coupon.couponDate.slice(0, 10),
      ticker,
      name,
      kind: 'coupon',
      perUnit: round(perUnit),
      quantity,
      total: round(perUnit * quantity),
      // perUnit не null ⇒ payOneBond заведомо присутствует.
      currency: coupon.payOneBond!.currency,
    });
  }
  if (unknownCoupons > 0) {
    warnings.push(
      `${ticker}: у ${unknownCoupons} будущих купонов сумма ещё не объявлена — они не вошли в календарь.`,
    );
  }
  return events;
}

// Дивиденды позиции → события календаря (только объявленные будущие выплаты).
function dividendEvents(
  position: PortfolioPosition,
  name: string | null,
  dividends: DividendItem[],
  todayStartMs: number, // начало текущих суток по МСК (UTC-момент, в ms)
): IncomeEventView[] {
  const quantity = quotationToNumber(position.quantity);
  const ticker = position.ticker ?? position.figi;
  const events: IncomeEventView[] = [];
  for (const dividend of dividends) {
    if (dividend.dividendType === 'Cancelled' || !dividend.dividendNet) {
      continue;
    }
    // Дата события — фактическая выплата; если её нет, дата фиксации реестра.
    const date = dividend.paymentDate ?? dividend.recordDate;
    // Прошлой считаем выплату строго ДО начала сегодняшнего дня по МСК:
    // граница — начало московских суток, а не интрадей-now, иначе сегодняшняя
    // выплата (UTC-полночь) ошибочно уходила в «прошлое».
    if (!date || Date.parse(date) < todayStartMs) {
      continue;
    }
    const perUnit = moneyToNumber(dividend.dividendNet);
    if (perUnit <= 0) {
      continue;
    }
    events.push({
      date: date.slice(0, 10),
      ticker,
      name,
      kind: 'dividend',
      perUnit: round(perUnit),
      quantity,
      total: round(perUnit * quantity),
      currency: dividend.dividendNet.currency,
    });
  }
  return events;
}

export function buildIncomeView(params: {
  accountId: string;
  from: string;
  to: string;
  positions: PortfolioPosition[];
  namesByUid: ReadonlyMap<string, string>;
  couponsByUid: ReadonlyMap<string, BondCoupon[]>;
  dividendsByUid: ReadonlyMap<string, DividendItem[]>;
  now: Date;
}): IncomeView {
  const warnings: string[] = [];
  const events: IncomeEventView[] = [];
  // Единая нижняя граница «прошлого» для всех дивидендов — начало московского дня.
  const todayStartMs = moscowDayStart(params.now).getTime();

  for (const position of params.positions) {
    const name = params.namesByUid.get(position.instrumentUid) ?? null;
    if (position.instrumentType === 'bond') {
      const coupons = params.couponsByUid.get(position.instrumentUid) ?? [];
      events.push(...couponEvents(position, name, coupons, warnings));
    } else if (position.instrumentType === 'share' || position.instrumentType === 'etf') {
      const dividends = params.dividendsByUid.get(position.instrumentUid) ?? [];
      events.push(...dividendEvents(position, name, dividends, todayStartMs));
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date));

  // Месячные итоги и общий итог — только в рублях; валютные выплаты
  // показываем в событиях, но не смешиваем в сумме.
  const monthly = new Map<string, number>();
  let horizonTotal = 0;
  const foreignCurrencies = new Set<string>();
  for (const event of events) {
    if (event.currency !== 'rub') {
      foreignCurrencies.add(event.currency);
      continue;
    }
    const month = event.date.slice(0, 7);
    monthly.set(month, (monthly.get(month) ?? 0) + event.total);
    horizonTotal += event.total;
  }
  if (foreignCurrencies.size > 0) {
    warnings.push(
      `Выплаты в валютах (${[...foreignCurrencies].sort().join(', ')}) показаны в календаре, ` +
        'но не входят в рублёвые итоги.',
    );
  }

  return {
    accountId: params.accountId,
    from: params.from,
    to: params.to,
    events,
    monthlyTotals: [...monthly.entries()]
      .map(([month, total]) => ({ month, total: round(total) }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    horizonTotal: round(horizonTotal),
    warnings,
  };
}

export async function fetchIncome(
  api: IncomeApi,
  params: { explicitAccountId?: string; now: Date },
): Promise<IncomeView> {
  const accountId = await resolveAccountId(api, params.explicitAccountId);
  const portfolio = await api.getPortfolio(accountId);
  // Нижняя граница окна — начало московских суток, чтобы API вернул и сегодняшние
  // выплаты (они приходят UTC-полуночью и отсекались интрадей-моментом now).
  const windowStart = moscowDayStart(params.now);
  const from = windowStart.toISOString();
  const to = new Date(windowStart.getTime() + INCOME_HORIZON_DAYS * MS_PER_DAY).toISOString();

  const bondPositions = portfolio.positions.filter((p) => p.instrumentType === 'bond');
  const dividendPositions = portfolio.positions.filter(
    (p) => p.instrumentType === 'share' || p.instrumentType === 'etf',
  );
  const incomePositions = [...bondPositions, ...dividendPositions];

  // Имена инструментов — презентация для консультанта; выплаты — данные.
  // Три батча независимы, поэтому запускаем их параллельно (Promise.all);
  // при этом каждый сохраняет собственный троттлинг mapWithConcurrency
  // (concurrency + минимальный интервал стартов) против лимитов API.
  const throttle = { concurrency: BATCH_CONCURRENCY, minIntervalMs: BATCH_MIN_INTERVAL_MS };
  const [names, coupons, dividends] = await Promise.all([
    mapWithConcurrency(incomePositions, throttle, async (p) => {
      const { instrument } = await api.getInstrumentByUid(p.instrumentUid);
      return [p.instrumentUid, instrument.name] as const;
    }),
    mapWithConcurrency(bondPositions, throttle, async (p) => {
      const resp = await api.getBondCoupons(p.instrumentUid, from, to);
      return [p.instrumentUid, resp.events ?? []] as const;
    }),
    mapWithConcurrency(dividendPositions, throttle, async (p) => {
      const resp = await api.getDividends(p.instrumentUid, from, to);
      return [p.instrumentUid, resp.dividends ?? []] as const;
    }),
  ]);

  return buildIncomeView({
    accountId,
    from,
    to,
    positions: incomePositions,
    namesByUid: new Map(names),
    couponsByUid: new Map(coupons),
    dividendsByUid: new Map(dividends),
    now: params.now,
  });
}

export function renderIncome(view: IncomeView): string {
  const parts = [
    `Счёт: ${view.accountId}`,
    `Горизонт: ${view.from.slice(0, 10)} — ${view.to.slice(0, 10)}`,
    '',
  ];
  if (view.events.length === 0) {
    parts.push('Объявленных будущих выплат по позициям портфеля нет.');
  } else {
    parts.push(
      renderTable(
        ['Дата', 'Тикер', 'Тип', 'На бумагу', 'Кол-во', 'Сумма', 'Валюта'],
        view.events.map((e) => [
          e.date,
          e.ticker,
          e.kind === 'coupon' ? 'купон' : 'дивиденд',
          formatAmount(e.perUnit),
          formatAmount(e.quantity, 0),
          formatAmount(e.total),
          e.currency.toUpperCase(),
        ]),
      ),
      '',
      'Итого по месяцам (RUB):',
      ...view.monthlyTotals.map((m) => `  ${m.month}: ${formatAmount(m.total)}`),
      '',
      `Всего за горизонт: ${formatAmount(view.horizonTotal)} RUB`,
    );
  }
  for (const warning of view.warnings) {
    parts.push('', `⚠ ${warning}`);
  }
  return parts.join('\n');
}
