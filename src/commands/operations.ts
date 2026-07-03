/**
 * Команда operations: история исполненных операций по счёту
 * (OperationsService/GetOperationsByCursor с обходом всех страниц).
 *
 * Экспорты:
 * - OperationsCursorApi — контракт клиента (только курсорный метод);
 * - OperationsApi — контракт команды (курсор + счета);
 * - OperationView — представление операции;
 * - computeOperationsRange(days, now) — период [now - days; now] в ISO;
 * - fetchAllOperationItems(api, params) — обход курсорной пагинации;
 * - buildOperationViews(items) — маппинг + сортировка (свежие сверху);
 * - fetchOperations(api, params) — выбор счёта + загрузка + сборка;
 * - renderOperations(views) — таблица для вывода.
 */
import { AppError } from '../api/errors.js';
import { formatAmount, formatSigned, moneyToNumber } from '../api/money.js';
import type { GetOperationsByCursorResponse, OperationItem } from '../api/types.js';
import { MAX_OPERATIONS_PAGES, MS_PER_DAY, OPERATIONS_PAGE_LIMIT } from '../config/config.js';
// Даты операций приходят из API в UTC, а показываем их пользователю по МСК —
// поэтому время/дата обязаны проходить через московские форматтеры.
import { formatMoscowDate, formatMoscowDateTime } from '../format/datetime.js';
import { renderTable } from '../format/table.js';
import { DASH } from '../format/values.js';
import { resolveAccountId, type AccountsApi } from './resolve-account.js';

export interface OperationsCursorApi {
  getOperationsByCursor(params: {
    accountId: string;
    from: string;
    to: string;
    cursor?: string;
    limit: number;
  }): Promise<GetOperationsByCursorResponse>;
}

export interface OperationsApi extends AccountsApi, OperationsCursorApi {}

export interface OperationView {
  id: string;
  date: string;
  description: string; // описание операции («Покупка 10 лотов ...»)
  operationType: string | null;
  instrumentName: string | null; // название инструмента (для сделок)
  ticker: string | null;
  payment: number | null;
  currency: string | null;
  commission: number | null;
  figi: string | null;
  quantity: number | null;
  price: number | null;
}

// REST-шлюз в курсорном методе присылает пустые строки вместо отсутствующих
// значений (проверено вживую) — приводим их к честному null.
function emptyToNull(value: string | undefined): string | null {
  return value ? value : null;
}

// now передаётся явно (инъекция времени) — логика периода детерминированно тестируема.
export function computeOperationsRange(days: number, now: Date): { from: string; to: string } {
  return {
    from: new Date(now.getTime() - days * MS_PER_DAY).toISOString(),
    to: now.toISOString(),
  };
}

// Обход всех страниц курсора. Ограничение MAX_OPERATIONS_PAGES — защита от
// бесконечного цикла при некорректном ответе API: превышение — явная ошибка,
// а не тихая обрезка истории.
export async function fetchAllOperationItems(
  api: OperationsCursorApi,
  params: { accountId: string; from: string; to: string },
): Promise<OperationItem[]> {
  const items: OperationItem[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_OPERATIONS_PAGES; page += 1) {
    const resp = await api.getOperationsByCursor({ ...params, cursor, limit: OPERATIONS_PAGE_LIMIT });
    items.push(...(resp.items ?? []));
    if (!resp.hasNext || !resp.nextCursor) {
      return items;
    }
    cursor = resp.nextCursor;
  }
  throw new AppError({
    code: 'APP_TINVEST_TOO_MANY_OPERATIONS',
    userMessage:
      `История операций превысила ${MAX_OPERATIONS_PAGES * OPERATIONS_PAGE_LIMIT} записей за период. ` +
      'Сузьте период командой --days.',
  });
}

export function buildOperationViews(items: OperationItem[]): OperationView[] {
  return [...items]
    // Свежие операции сверху — так удобнее и человеку, и агенту.
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .map((op): OperationView => ({
      id: op.id,
      date: op.date,
      // Человекочитаемое описание от API; цепочка допустима — чистая презентация.
      description: op.description || op.type || '—',
      operationType: emptyToNull(op.type),
      instrumentName: emptyToNull(op.name),
      ticker: emptyToNull(op.ticker),
      payment: op.payment ? moneyToNumber(op.payment) : null,
      currency: op.payment?.currency ?? null,
      // Нулевая комиссия у операций без комиссии — отсутствие данных, не 0.
      commission: op.commission && moneyToNumber(op.commission) !== 0 ? moneyToNumber(op.commission) : null,
      figi: emptyToNull(op.figi),
      // «0» у операций без количества (дивиденды, комиссии) — показываем null, не 0.
      quantity: op.quantity && op.quantity !== '0' ? Number(op.quantity) : null,
      // Нулевая «цена» у неторговых операций (пополнение, комиссия) —
      // это отсутствие цены, а не цена 0 (живой кейс из песочницы).
      price: op.price && moneyToNumber(op.price) !== 0 ? moneyToNumber(op.price) : null,
    }));
}

export async function fetchOperations(
  api: OperationsApi,
  params: { explicitAccountId?: string; days: number; now: Date },
): Promise<{ accountId: string; from: string; to: string; operations: OperationView[] }> {
  const accountId = await resolveAccountId(api, params.explicitAccountId);
  const { from, to } = computeOperationsRange(params.days, params.now);
  const items = await fetchAllOperationItems(api, { accountId, from, to });
  return { accountId, from, to, operations: buildOperationViews(items) };
}

export function renderOperations(result: {
  accountId: string;
  from: string;
  to: string;
  operations: OperationView[];
}): string {
  // Границы периода — пользователю по МСК (иначе у вечерних границ уедет день).
  const header = [
    `Счёт: ${result.accountId}`,
    `Период: ${formatMoscowDate(result.from)} — ${formatMoscowDate(result.to)}`,
    `Операций: ${result.operations.length}`,
    '',
  ].join('\n');

  if (result.operations.length === 0) {
    return `${header}За выбранный период исполненных операций нет.`;
  }

  const table = renderTable(
    ['Дата', 'Операция', 'Тикер', 'Сумма', 'Валюта', 'Кол-во', 'Цена', 'Комиссия'],
    result.operations.map((op) => [
      // Время операции — в МСК: голый срез UTC смещал бы время на -3ч, а у
      // ночных/вечерних сделок уводил бы календарную дату на день назад.
      formatMoscowDateTime(op.date),
      op.description,
      op.ticker ?? DASH,
      op.payment !== null ? formatSigned(op.payment) : DASH,
      op.currency !== null ? op.currency.toUpperCase() : DASH,
      op.quantity !== null ? formatAmount(op.quantity, 0) : DASH,
      op.price !== null ? formatAmount(op.price) : DASH,
      op.commission !== null ? formatSigned(op.commission) : DASH,
    ]),
  );
  return `${header}${table}`;
}
