/**
 * Мок-фикстуры ответа OperationsService/GetOperationsByCursor для тестов.
 *
 * Экспорты:
 * - operationsCursorPage1 / operationsCursorPage2 — двухстраничная выдача
 *   (проверка пагинации): покупка + комиссия на первой странице,
 *   дивиденды и пополнение на второй; даты намеренно не отсортированы,
 *   чтобы проверить сортировку «свежие сверху».
 */
import type { GetOperationsByCursorResponse } from '../types.js';

export const operationsCursorPage1: GetOperationsByCursorResponse = {
  hasNext: true,
  nextCursor: 'cursor-page-2',
  items: [
    // Покупка акций: у сделки есть цена, количество и отдельная комиссия.
    {
      id: 'op-buy-1',
      date: '2026-06-15T10:30:00Z',
      state: 'OPERATION_STATE_EXECUTED',
      name: 'Сбер Банк',
      ticker: 'SBER',
      description: 'Покупка 100 лотов акции Сбер Банк',
      type: 'OPERATION_TYPE_BUY',
      payment: { currency: 'rub', units: '-25000', nano: 0 },
      price: { currency: 'rub', units: '250', nano: 0 },
      commission: { currency: 'rub', units: '-12', nano: -500000000 },
      quantity: '100',
      figi: 'BBG004730N88',
      instrumentType: 'share',
      instrumentUid: 'uid-sber',
    },
    // Комиссия брокера отдельной операцией (самая ранняя по дате).
    {
      id: 'op-fee-1',
      date: '2026-06-15T10:30:01Z',
      state: 'OPERATION_STATE_EXECUTED',
      name: 'Сбер Банк',
      ticker: 'SBER',
      description: 'Удержание комиссии за операцию',
      type: 'OPERATION_TYPE_BROKER_FEE',
      payment: { currency: 'rub', units: '-12', nano: -500000000 },
      figi: 'BBG004730N88',
      instrumentType: 'share',
    },
  ],
};

export const operationsCursorPage2: GetOperationsByCursorResponse = {
  hasNext: false,
  items: [
    // Дивиденды (самая свежая операция — первой после сортировки).
    // Нулевая price — живой кейс: у неторговых операций API присылает цену 0.
    {
      id: 'op-div-1',
      date: '2026-06-28T00:00:00Z',
      state: 'OPERATION_STATE_EXECUTED',
      name: 'Сбер Банк',
      ticker: 'SBER',
      description: 'Выплата дивидендов',
      type: 'OPERATION_TYPE_DIVIDEND',
      payment: { currency: 'rub', units: '120', nano: 500000000 },
      price: { currency: 'rub', units: '0', nano: 0 },
      figi: 'BBG004730N88',
      instrumentType: 'share',
      instrumentUid: 'uid-sber',
    },
    // Пополнение счёта: внешний денежный поток (важно для XIRR).
    {
      id: 'op-input-1',
      date: '2026-06-01T09:00:00Z',
      state: 'OPERATION_STATE_EXECUTED',
      name: '',
      ticker: '',
      figi: '',
      description: 'Пополнение счета',
      type: 'OPERATION_TYPE_INPUT',
      payment: { currency: 'rub', units: '50000', nano: 0 },
    },
  ],
};
