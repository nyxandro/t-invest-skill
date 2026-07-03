/**
 * Команда dividends: история дивидендов и дивидендная доходность.
 *
 * Экспорты:
 * - DividendsApi — контракт клиента для команды;
 * - DividendPaymentView, DividendsView — представление;
 * - fetchDividends(api, query, now) — история за DIVIDENDS_LOOKBACK_YEARS лет,
 *   объявленные будущие выплаты и TTM-доходность к текущей цене;
 * - renderDividends(view) — таблица для терминала.
 *
 * TTM-доходность = сумма выплат с датой фиксации реестра за последние
 * 365 дней / текущая цена. Это трейлинг-метрика: будущие дивиденды могут
 * отличаться (отдельно показываем уже объявленные). Доходность считается
 * только при совпадении валюты выплат и валюты котировки; иначе — null и
 * предупреждение (см. warnings в DividendsView).
 */
import { moneyToNumber, quotationToNumber } from '../api/money.js';
import type { DividendItem, GetDividendsResponse, GetLastPricesResponse } from '../api/types.js';
import { MS_PER_DAY, MS_PER_YEAR } from '../config/config.js';
import { DASH, formatOrDash, percentOrDash } from '../format/values.js';
import { renderTable } from '../format/table.js';
import { resolveInstrument, type InstrumentSearchApi } from './resolve-instrument.js';

export interface DividendsApi extends InstrumentSearchApi {
  getDividends(instrumentId: string, from: string, to: string): Promise<GetDividendsResponse>;
  getLastPrices(instrumentIds: string[]): Promise<GetLastPricesResponse>;
}

// Глубина истории и горизонт объявленных выплат. Единицы времени (MS_PER_DAY,
// MS_PER_YEAR) берём из общего конфига, а не дублируем локально.
const DIVIDENDS_LOOKBACK_YEARS = 6;
const DIVIDENDS_LOOKAHEAD_DAYS = 366;
const TTM_WINDOW_DAYS = 365;

export interface DividendPaymentView {
  recordDate: string | null; // дата фиксации реестра
  lastBuyDate: string | null; // последний день покупки под выплату
  paymentDate: string | null;
  amount: number | null; // на одну бумагу
  currency: string | null;
  yieldPercent: number | null; // доходность выплаты по данным API
  regularity: string | null;
}

export interface DividendsView {
  ticker: string;
  name: string;
  currentPrice: number | null;
  currency: string | null;
  ttmSum: number | null; // выплачено на бумагу за последние 12 месяцев
  ttmYieldPercent: number | null; // TTM-сумма к текущей цене
  upcoming: DividendPaymentView[]; // объявленные будущие выплаты
  history: DividendPaymentView[]; // прошедшие, новые сверху
  // Предупреждения о несопоставимости данных (например, дивиденды и цена
  // в разных валютах — доходность не рассчитана).
  warnings: string[];
}

// Ключевая дата выплаты для фильтров — дата фиксации реестра;
// у некоторых записей её нет, тогда ориентируемся на дату выплаты.
function eventTime(item: DividendItem): number | null {
  const raw = item.recordDate ?? item.paymentDate;
  return raw ? new Date(raw).getTime() : null;
}

function toPaymentView(item: DividendItem): DividendPaymentView {
  return {
    recordDate: item.recordDate ?? null,
    lastBuyDate: item.lastBuyDate ?? null,
    paymentDate: item.paymentDate ?? null,
    amount: item.dividendNet ? moneyToNumber(item.dividendNet) : null,
    currency: item.dividendNet?.currency ?? null,
    yieldPercent: item.yieldValue ? quotationToNumber(item.yieldValue) : null,
    regularity: item.regularity ?? null,
  };
}

export async function fetchDividends(
  api: DividendsApi,
  query: string,
  now: Date,
): Promise<DividendsView> {
  // Дивиденды платят и акции, и фонды — тип инструмента не ограничиваем.
  const resolved = await resolveInstrument(api, query);

  const from = new Date(now.getTime() - DIVIDENDS_LOOKBACK_YEARS * MS_PER_YEAR).toISOString();
  const to = new Date(now.getTime() + DIVIDENDS_LOOKAHEAD_DAYS * MS_PER_DAY).toISOString();
  const [dividendsResponse, pricesResponse] = await Promise.all([
    api.getDividends(resolved.uid, from, to),
    api.getLastPrices([resolved.uid]),
  ]);

  // Отменённые выплаты не влияют ни на историю доходности, ни на планы.
  const payments = (dividendsResponse.dividends ?? [])
    .filter((d) => d.dividendType !== 'Cancelled')
    .sort((a, b) => (eventTime(b) ?? 0) - (eventTime(a) ?? 0));

  const upcoming = payments.filter((d) => (eventTime(d) ?? 0) > now.getTime());
  const history = payments.filter((d) => (eventTime(d) ?? 0) <= now.getTime());

  // Предупреждения о несопоставимости данных (валюты и т. п.).
  const warnings: string[] = [];

  // TTM: сумма выплат за последние 365 дней. Если среди них есть выплаты
  // без суммы или в разных валютах — сумма несопоставима, честный null.
  const ttmWindowStart = now.getTime() - TTM_WINDOW_DAYS * MS_PER_DAY;
  const ttmItems = history.filter((d) => (eventTime(d) ?? 0) > ttmWindowStart);
  const ttmCurrencies = new Set(ttmItems.map((d) => d.dividendNet?.currency ?? 'unknown'));
  const ttmComputable =
    ttmItems.length > 0 && ttmCurrencies.size === 1 && !ttmCurrencies.has('unknown');
  const ttmSum = ttmComputable
    ? ttmItems.reduce((sum, d) => sum + moneyToNumber(d.dividendNet!), 0)
    : null;
  // Единственная валюта выплат TTM (когда сумма сопоставима) — нужна ниже для
  // сверки с валютой котировки.
  const ttmCurrency = ttmComputable ? [...ttmCurrencies][0]! : null;

  const lastPrice = pricesResponse.lastPrices.find((p) => p.instrumentUid === resolved.uid);
  const currentPrice = lastPrice?.price ? quotationToNumber(lastPrice.price) : null;

  // K6: доходность = сумма дивидендов / цена, поэтому валюта выплат обязана
  // совпадать с валютой котировки инструмента (resolved.currency). Кейс ГДР:
  // дивиденды в USD, цена на МосБирже в рублях — деля USD на RUB, получили бы
  // доходность, заниженную в ~курс раз. Курсов в ответах API здесь нет, привести
  // к одной валюте нельзя. no-fallbacks: при подтверждённом расхождении валют не
  // считаем доходность молча — ttmYieldPercent=null + явное предупреждение.
  const priceCurrency = resolved.currency ?? null;
  const currencyMismatch =
    ttmCurrency !== null &&
    priceCurrency !== null &&
    ttmCurrency.toLowerCase() !== priceCurrency.toLowerCase();
  if (currencyMismatch) {
    warnings.push(
      `Дивиденды в ${ttmCurrency!.toUpperCase()}, цена в ${priceCurrency!.toUpperCase()} — ` +
        'доходность TTM не рассчитана из-за разных валют.',
    );
  }

  const ttmYieldPercent =
    ttmSum !== null && currentPrice !== null && currentPrice > 0 && !currencyMismatch
      ? (ttmSum / currentPrice) * 100
      : null;

  return {
    ticker: resolved.ticker,
    name: resolved.name,
    currentPrice,
    currency: resolved.currency ?? null,
    ttmSum,
    ttmYieldPercent,
    upcoming: upcoming.map(toPaymentView),
    history: history.map(toPaymentView),
    warnings,
  };
}

export function renderDividends(view: DividendsView): string {
  // Прочерк «нет данных» и формат процентов — из общих values-хелперов,
  // чтобы «—» и «%» выглядели одинаково во всех командах.
  const lines = [
    `${view.name} (${view.ticker})`,
    `Текущая цена: ${formatOrDash(view.currentPrice)}`,
    `Выплачено за 12 мес: ${formatOrDash(view.ttmSum)}` +
      `  Дивдоходность TTM: ${percentOrDash(view.ttmYieldPercent)}`,
  ];

  const row = (p: DividendPaymentView): string[] => [
    p.recordDate ? p.recordDate.slice(0, 10) : DASH,
    p.lastBuyDate ? p.lastBuyDate.slice(0, 10) : DASH,
    formatOrDash(p.amount),
    percentOrDash(p.yieldPercent),
  ];
  const headers = ['Реестр', 'Купить до', 'На бумагу', 'Доходность'];

  if (view.upcoming.length > 0) {
    lines.push('', 'Объявленные выплаты:', renderTable(headers, view.upcoming.map(row)));
  }
  if (view.history.length > 0) {
    lines.push('', 'История выплат:', renderTable(headers, view.history.map(row)));
  } else {
    lines.push('', 'Выплат за рассматриваемый период не найдено.');
  }
  // Предупреждения (несопоставимость валют и т. п.) — заметным блоком в конце.
  for (const warning of view.warnings) {
    lines.push('', `⚠ ${warning}`);
  }
  return lines.join('\n');
}
