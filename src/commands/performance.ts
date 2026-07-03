/**
 * Команда performance: реальная доходность счёта с учётом пополнений,
 * выводов, дивидендов, купонов, комиссий и налогов (XIRR + разбивка).
 *
 * Методика: внешние денежные потоки (пополнения/выводы) + текущая стоимость
 * портфеля → money-weighted доходность (XIRR). Всё внутреннее (сделки,
 * дивиденды, комиссии) уже отражено в текущей стоимости, поэтому в потоки
 * не входит, но показывается в разбивке за период.
 *
 * Экспорты:
 * - PerformanceApi — контракт клиента;
 * - OperationBucket, classifyOperationType(type) — классификация операций;
 * - buildPerformanceView(params) — чистая сборка представления из операций
 *   и стоимости портфеля (тестируется без API);
 * - fetchPerformance(api, params) — загрузка данных + сборка;
 * - renderPerformance(view) — человекочитаемый отчёт.
 */
import { AppError } from '../api/errors.js';
import { formatAmount, formatSigned, moneyToNumber, round } from '../api/money.js';
import type { GetAccountsResponse, OperationItem, PortfolioResponse } from '../api/types.js';
import { computeXirrPercent, type CashFlow } from '../analytics/xirr.js';
import { EXTREME_XIRR_WARN_PERCENT } from '../config/config.js';
import { DASH } from '../format/values.js';
import { fetchAllOperationItems, type OperationsCursorApi } from './operations.js';
import { resolveAccountId, type AccountsApi } from './resolve-account.js';

export interface PerformanceApi extends AccountsApi, OperationsCursorApi {
  getAccounts(): Promise<GetAccountsResponse>;
  getPortfolio(accountId: string): Promise<PortfolioResponse>;
}

// Смысловые корзины операций для разбивки и потоков XIRR.
export type OperationBucket =
  | 'input' // пополнение деньгами — внешний поток
  | 'output' // вывод денег — внешний поток
  | 'securities-transfer' // завод/вывод бумаг — внешний поток без денежной оценки
  | 'dividend'
  | 'coupon'
  | 'commission'
  | 'tax'
  | 'trade' // покупки/продажи — внутренние потоки
  | 'other';

// Классификация по enum OPERATION_TYPE_*: порядок проверок важен —
// DIVIDEND_TAX должен попасть в налоги, а не в дивиденды.
export function classifyOperationType(type: string | null): OperationBucket {
  if (!type) {
    return 'other';
  }
  if (type === 'OPERATION_TYPE_INPUT_SECURITIES' || type === 'OPERATION_TYPE_OUTPUT_SECURITIES') {
    return 'securities-transfer';
  }
  if (type.includes('TAX')) {
    return 'tax';
  }
  if (type.includes('FEE')) {
    return 'commission';
  }
  if (type.includes('DIVIDEND')) {
    return 'dividend';
  }
  if (type.includes('COUPON')) {
    return 'coupon';
  }
  if (type.startsWith('OPERATION_TYPE_INPUT')) {
    return 'input';
  }
  if (type.startsWith('OPERATION_TYPE_OUTPUT')) {
    return 'output';
  }
  // includes уже покрывает точные OPERATION_TYPE_BUY/SELL и вариации
  // (например, ..._BUY_CARD, ..._SELL_MARGIN) — отдельные exact-сравнения избыточны.
  if (type.includes('BUY') || type.includes('SELL')) {
    return 'trade';
  }
  return 'other';
}

// Денежные корзины: для них отсутствие payment означает потерю ДЕНЕЖНЫХ данных
// (искажение invested/withdrawn/XIRR или разбивки), а не техническую запись.
// 'other' и 'securities-transfer' сюда не входят: первое — записи без денежного
// эффекта, второе обрабатывается отдельным предупреждением о переводах бумаг.
const MONETARY_BUCKETS: ReadonlySet<OperationBucket> = new Set([
  'input',
  'output',
  'dividend',
  'coupon',
  'commission',
  'tax',
  'trade',
]);

export interface PerformanceView {
  accountId: string;
  from: string; // начало анализа — дата открытия счёта
  to: string;
  currency: string; // валюта расчёта (rub)
  invested: number; // сумма пополнений
  withdrawn: number; // сумма выводов (по модулю)
  currentValue: number; // текущая стоимость портфеля
  netProfit: number; // currentValue + withdrawn - invested
  netProfitPercent: number | null; // к вложенному капиталу
  xirrPercent: number | null; // годовая money-weighted доходность
  breakdown: {
    dividends: number;
    coupons: number;
    commissions: number;
    taxes: number;
  };
  operationsCount: number;
  warnings: string[];
}

export function buildPerformanceView(params: {
  accountId: string;
  from: string;
  to: string;
  items: OperationItem[];
  currentValue: number;
  now: Date;
}): PerformanceView {
  const { accountId, from, to, items, currentValue, now } = params;
  const warnings: string[] = [];
  const flows: CashFlow[] = [];
  let invested = 0;
  let withdrawn = 0;
  const breakdown = { dividends: 0, coupons: 0, commissions: 0, taxes: 0 };
  const skippedCurrencies = new Set<string>();
  let hasSecuritiesTransfer = false;
  let skippedNoPayment = 0; // денежные операции без payment (K18: не теряем молча)

  for (const op of items) {
    const bucket = classifyOperationType(op.type ?? null);
    if (bucket === 'securities-transfer') {
      hasSecuritiesTransfer = true;
      continue;
    }
    if (!op.payment) {
      // no-fallbacks: денежную операцию без суммы платежа нельзя молча выкинуть —
      // это исказит потоки/разбивку. Технические записи ('other') пропускаем тихо.
      if (MONETARY_BUCKETS.has(bucket)) {
        skippedNoPayment += 1;
      }
      continue;
    }
    // Расчёт ведём в рублях: валютные операции суммировать с рублёвыми нельзя.
    if (op.payment.currency !== 'rub') {
      skippedCurrencies.add(op.payment.currency);
      continue;
    }
    const amount = moneyToNumber(op.payment);
    switch (bucket) {
      case 'input':
        invested += amount;
        // Знак потока — с позиции инвестора: пополнение = вложение (минус).
        flows.push({ date: new Date(op.date), amount: -amount });
        break;
      case 'output':
        withdrawn += -amount; // payment вывода отрицательный
        flows.push({ date: new Date(op.date), amount: -amount });
        break;
      case 'dividend':
        breakdown.dividends += amount;
        break;
      case 'coupon':
        breakdown.coupons += amount;
        break;
      case 'commission':
        breakdown.commissions += amount;
        break;
      case 'tax':
        breakdown.taxes += amount;
        break;
      default:
        break; // trade/other — внутренние потоки, отражены в стоимости портфеля
    }
  }

  if (skippedCurrencies.size > 0) {
    warnings.push(
      `Операции в валютах (${[...skippedCurrencies].sort().join(', ')}) не входят в расчёт — ` +
        'доходность посчитана только по рублёвым потокам.',
    );
  }
  if (hasSecuritiesTransfer) {
    warnings.push(
      'По счёту были переводы ценных бумаг (завод/вывод) — их денежная оценка недоступна, ' +
        'XIRR может быть искажён.',
    );
  }
  if (skippedNoPayment > 0) {
    warnings.push(
      `${skippedNoPayment} денежных операций без суммы платежа исключены из расчёта — ` +
        'доходность может быть неполной.',
    );
  }

  // Замыкающий поток — текущая стоимость портфеля «как будто продали сегодня».
  const flowsWithFinal =
    currentValue > 0 ? [...flows, { date: now, amount: currentValue }] : flows;
  const xirrPercent = computeXirrPercent(flowsWithFinal);
  if (xirrPercent === null && flows.length > 0) {
    warnings.push('XIRR не рассчитан: недостаточно разнознаковых денежных потоков за период.');
  }
  if (xirrPercent !== null && Math.abs(xirrPercent) > EXTREME_XIRR_WARN_PERCENT) {
    // Money-weighted ставка взрывается, когда деньги работали короткими
    // интервалами (вложил → быстро вывел больше). Это математически верно,
    // но интуиции «доходность за год» не соответствует — предупреждаем.
    warnings.push(
      'XIRR экстремален из-за частых пополнений/выводов при небольшом работающем капитале — ' +
        'ориентируйтесь в первую очередь на чистый результат в рублях.',
    );
  }

  const netProfit = currentValue + withdrawn - invested;
  return {
    accountId,
    from,
    to,
    currency: 'rub',
    invested: round(invested),
    withdrawn: round(withdrawn),
    currentValue: round(currentValue),
    netProfit: round(netProfit),
    netProfitPercent: invested > 0 ? round((netProfit / invested) * 100) : null,
    xirrPercent: xirrPercent !== null ? round(xirrPercent) : null,
    breakdown: {
      dividends: round(breakdown.dividends),
      coupons: round(breakdown.coupons),
      commissions: round(breakdown.commissions),
      taxes: round(breakdown.taxes),
    },
    operationsCount: items.length,
    warnings,
  };
}

export async function fetchPerformance(
  api: PerformanceApi,
  params: { explicitAccountId?: string; now: Date },
): Promise<PerformanceView> {
  // K36: список счетов нужен и для выбора счёта, и для openedDate — тянем его
  // один раз, а правила выбора (no-fallbacks) переиспользуем через resolveAccountId,
  // отдав ему уже полученный ответ вместо повторного сетевого вызова.
  const { accounts } = await api.getAccounts();
  const accountId = await resolveAccountId(
    { getAccounts: async () => ({ accounts }) },
    params.explicitAccountId,
  );

  // Дата открытия счёта — обязательная точка отсчёта: без неё XIRR по части
  // истории даст ложную цифру (начальная стоимость портфеля неизвестна).
  const account = accounts.find((a) => a.id === accountId);
  if (!account?.openedDate) {
    throw new AppError({
      code: 'APP_TINVEST_ACCOUNT_OPEN_DATE_MISSING',
      userMessage:
        'API не вернул дату открытия счёта — рассчитать доходность с начала инвестирования невозможно.',
    });
  }

  const from = new Date(account.openedDate).toISOString();
  const to = params.now.toISOString();
  // Операции и портфель независимы — грузим параллельно (K36).
  const [items, portfolio] = await Promise.all([
    fetchAllOperationItems(api, { accountId, from, to }),
    api.getPortfolio(accountId),
  ]);
  return buildPerformanceView({
    accountId,
    from,
    to,
    items,
    currentValue: moneyToNumber(portfolio.totalAmountPortfolio),
    now: params.now,
  });
}

export function renderPerformance(view: PerformanceView): string {
  const lines = [
    `Счёт: ${view.accountId}`,
    `Период: ${view.from.slice(0, 10)} — ${view.to.slice(0, 10)} (с открытия счёта)`,
    '',
    `Вложено (пополнения):     ${formatAmount(view.invested)} RUB`,
    `Выведено:                 ${formatAmount(view.withdrawn)} RUB`,
    `Текущая стоимость:        ${formatAmount(view.currentValue)} RUB`,
    `Чистый результат:         ${formatSigned(view.netProfit)} RUB` +
      (view.netProfitPercent !== null ? ` (${formatSigned(view.netProfitPercent)} % к вложенному)` : ''),
    `Годовая доходность XIRR:  ${view.xirrPercent !== null ? `${formatSigned(view.xirrPercent)} %` : DASH}`,
    '',
    'За период получено/уплачено:',
    `  Дивиденды: ${formatSigned(view.breakdown.dividends)}`,
    `  Купоны:    ${formatSigned(view.breakdown.coupons)}`,
    `  Комиссии:  ${formatSigned(view.breakdown.commissions)}`,
    `  Налоги:    ${formatSigned(view.breakdown.taxes)}`,
  ];
  for (const warning of view.warnings) {
    lines.push('', `⚠ ${warning}`);
  }
  return lines.join('\n');
}
