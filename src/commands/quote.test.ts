/**
 * Тесты команды quote: точное совпадение тикера, объединение с последними
 * ценами, явные ошибки при отсутствии инструмента или котировки.
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../api/errors.js';
import {
  emptyLastPricesFixture,
  findInstrumentResponseFixture,
  lastPricesResponseFixture,
  pricelessLastPricesFixture,
} from '../api/mocks/market.fixture.js';
import { getQuotes } from './quote.js';

// Стаб API рынка: поиск и цены отдают заданные фикстуры.
function apiWith(
  find = findInstrumentResponseFixture,
  prices = lastPricesResponseFixture,
) {
  return {
    findInstrument: async () => find,
    getLastPrices: async () => prices,
  };
}

describe('getQuotes', () => {
  it('находит инструмент по точному тикеру (без учёта регистра) и отдаёт цену', async () => {
    const quotes = await getQuotes(apiWith(), 'sber');

    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      ticker: 'SBER',
      name: 'Сбер Банк',
      classCode: 'TQBR',
      price: 305.5,
      currency: 'rub',
      lot: 10,
    });
  });

  it('без точного совпадения тикера падает APP_TINVEST_INSTRUMENT_NOT_FOUND с подсказкой про search', async () => {
    const err = await getQuotes(apiWith(), 'сбербанк').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('APP_TINVEST_INSTRUMENT_NOT_FOUND');
    expect((err as AppError).userMessage).toContain('search');
  });

  it('запись без поля price не роняет команду, а считается отсутствием котировки', async () => {
    // Живой кейс: торги не идут → запись в lastPrices без price/time.
    const err = await getQuotes(
      apiWith(findInstrumentResponseFixture, pricelessLastPricesFixture),
      'SBERP',
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('APP_TINVEST_PRICE_UNAVAILABLE');
  });

  it('если цены нет ни по одному совпадению — APP_TINVEST_PRICE_UNAVAILABLE', async () => {
    const err = await getQuotes(apiWith(findInstrumentResponseFixture, emptyLastPricesFixture), 'SBER').catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('APP_TINVEST_PRICE_UNAVAILABLE');
  });
});
