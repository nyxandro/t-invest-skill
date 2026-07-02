/**
 * Мок-фикстуры рыночных данных для тестов.
 *
 * Экспорты:
 * - findInstrumentResponseFixture — результат поиска по «SBER»
 *   (обыкновенная и привилегированная акции);
 * - lastPricesResponseFixture — последняя цена SBER 305.50;
 * - emptyLastPricesFixture — котировка недоступна.
 */
import type { FindInstrumentResponse, GetLastPricesResponse } from '../types.js';

export const findInstrumentResponseFixture: FindInstrumentResponse = {
  instruments: [
    {
      uid: 'uid-sber',
      figi: 'BBG004730N88',
      ticker: 'SBER',
      classCode: 'TQBR',
      isin: 'RU0009029540',
      instrumentType: 'share',
      name: 'Сбер Банк',
      exchange: 'MOEX_EVENING_WEEKEND',
      lot: 10,
      currency: 'rub',
      apiTradeAvailableFlag: true,
    },
    {
      uid: 'uid-sberp',
      figi: 'BBG0047315Y7',
      ticker: 'SBERP',
      classCode: 'TQBR',
      isin: 'RU0009029557',
      instrumentType: 'share',
      name: 'Сбер Банк — привилегированные акции',
      exchange: 'MOEX_EVENING_WEEKEND',
      lot: 10,
      currency: 'rub',
      apiTradeAvailableFlag: true,
    },
  ],
};

export const lastPricesResponseFixture: GetLastPricesResponse = {
  lastPrices: [
    {
      figi: 'BBG004730N88',
      instrumentUid: 'uid-sber',
      price: { units: '305', nano: 500000000 },
      time: '2026-07-02T10:00:00Z',
    },
  ],
};

// Кейс «цена недоступна»: API вернул пустой список.
export const emptyLastPricesFixture: GetLastPricesResponse = { lastPrices: [] };

// Кейс «запись без цены»: если торгов нет, REST-шлюз присылает запись
// без полей price/time (protobuf JSON опускает незаполненные поля).
export const pricelessLastPricesFixture: GetLastPricesResponse = {
  lastPrices: [
    {
      figi: 'BBG0047315Y7',
      instrumentUid: 'uid-sberp',
    },
  ],
};
