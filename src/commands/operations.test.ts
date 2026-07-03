/**
 * Тесты команды operations: расчёт периода, курсорная пагинация,
 * маппинг операций и сортировка по дате (свежие сверху).
 */
import { describe, expect, it } from 'vitest';
import { operationsCursorPage1, operationsCursorPage2 } from '../api/mocks/operations.fixture.js';
import type { GetOperationsByCursorResponse } from '../api/types.js';
import {
  buildOperationViews,
  computeOperationsRange,
  fetchAllOperationItems,
  renderOperations,
  type OperationView,
} from './operations.js';

describe('computeOperationsRange', () => {
  it('строит период [now - days; now] в ISO-формате', () => {
    const now = new Date('2026-07-02T12:00:00.000Z');
    const range = computeOperationsRange(30, now);

    expect(range.to).toBe('2026-07-02T12:00:00.000Z');
    expect(range.from).toBe('2026-06-02T12:00:00.000Z');
  });
});

describe('fetchAllOperationItems', () => {
  it('обходит все страницы курсора и передаёт nextCursor между запросами', async () => {
    const requestedCursors: (string | undefined)[] = [];
    const api = {
      async getOperationsByCursor(params: {
        cursor?: string;
      }): Promise<GetOperationsByCursorResponse> {
        requestedCursors.push(params.cursor);
        return params.cursor ? operationsCursorPage2 : operationsCursorPage1;
      },
    };
    const items = await fetchAllOperationItems(api, {
      accountId: 'acc-1',
      from: '2026-06-01T00:00:00Z',
      to: '2026-07-01T00:00:00Z',
    });

    expect(requestedCursors).toEqual([undefined, 'cursor-page-2']);
    expect(items.map((i) => i.id)).toEqual(['op-buy-1', 'op-fee-1', 'op-div-1', 'op-input-1']);
  });
});

describe('buildOperationViews', () => {
  const items = [...(operationsCursorPage1.items ?? []), ...(operationsCursorPage2.items ?? [])];
  const views = buildOperationViews(items);

  it('сортирует операции по дате по убыванию', () => {
    expect(views.map((v) => v.id)).toEqual(['op-div-1', 'op-fee-1', 'op-buy-1', 'op-input-1']);
  });

  it('конвертирует платёж (включая отрицательные суммы с nano)', () => {
    const fee = views.find((v) => v.id === 'op-fee-1');
    expect(fee?.payment).toBe(-12.5);
    expect(fee?.currency).toBe('rub');
  });

  it('маппит описание, количество, цену и комиссию', () => {
    const buy = views.find((v) => v.id === 'op-buy-1');
    expect(buy?.description).toBe('Покупка 100 лотов акции Сбер Банк');
    expect(buy?.instrumentName).toBe('Сбер Банк');
    expect(buy?.ticker).toBe('SBER');
    expect(buy?.operationType).toBe('OPERATION_TYPE_BUY');
    expect(buy?.quantity).toBe(100);
    expect(buy?.price).toBe(250);
    expect(buy?.commission).toBe(-12.5);
    // У дивидендов нет количества — null, а не выдуманный 0.
    const div = views.find((v) => v.id === 'op-div-1');
    expect(div?.quantity).toBeNull();
    expect(div?.payment).toBe(120.5);
    // Нулевая «цена» неторговой операции — это отсутствие цены (null), не 0.
    expect(div?.price).toBeNull();
    // У пополнения нет комиссии — null.
    const input = views.find((v) => v.id === 'op-input-1');
    expect(input?.commission).toBeNull();
    // Пустые строки REST-шлюза ("" вместо отсутствующих) нормализуются в null.
    expect(input?.instrumentName).toBeNull();
    expect(input?.ticker).toBeNull();
    expect(input?.figi).toBeNull();
  });
});

describe('renderOperations (K8: время операции в МСК)', () => {
  // Ночная сделка: 22:30 UTC = 01:30 МСК СЛЕДУЮЩЕГО календарного дня —
  // при наивном срезе UTC печаталась бы вчерашняя дата и время на 3ч раньше.
  const nightOperation: OperationView = {
    id: 'op-night',
    date: '2026-07-02T22:30:00Z',
    description: 'Покупка облигации',
    operationType: 'OPERATION_TYPE_BUY',
    instrumentName: 'ОФЗ',
    ticker: 'SU26240',
    payment: -1000,
    currency: 'rub',
    commission: null,
    figi: 'BBG-ofz',
    quantity: 1,
    price: 1000,
  };

  it('выводит время операции в МСК, сдвигая и время, и календарную дату', () => {
    const out = renderOperations({
      accountId: 'acc-1',
      from: '2026-06-02T21:00:00.000Z', // 2026-06-03 00:00 МСК
      to: '2026-07-02T21:00:00.000Z', // 2026-07-03 00:00 МСК
      operations: [nightOperation],
    });

    // Ячейка времени: дата уехала на 2026-07-03, время 01:30 (МСК), не UTC.
    expect(out).toContain('2026-07-03 01:30');
    expect(out).not.toContain('2026-07-02 22:30');
    // Заголовок периода тоже в МСК (границы сдвинулись на день вперёд).
    expect(out).toContain('Период: 2026-06-03 — 2026-07-03');
  });
});
