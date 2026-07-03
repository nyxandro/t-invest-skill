/**
 * Тесты команды quote: резолв по тикеру И ISIN (K26), поддержка индексов через
 * индикативы (K44), корректная обработка отсутствия котировки (null, не 0).
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../api/errors.js';
import {
  emptyLastPricesFixture,
  findInstrumentResponseFixture,
  lastPricesResponseFixture,
  pricelessLastPricesFixture,
} from '../api/mocks/market.fixture.js';
import type { GetLastPricesResponse } from '../api/types.js';
import { getQuotes } from './quote.js';

// Стаб API рынка: поиск, индикативы (по умолчанию пусто) и цены отдают фикстуры.
function apiWith(
  find = findInstrumentResponseFixture,
  prices = lastPricesResponseFixture,
  indicatives: { instruments: { uid: string; ticker: string; name: string }[] } = {
    instruments: [],
  },
) {
  return {
    findInstrument: async () => find,
    getIndicatives: async () => indicatives,
    getLastPrices: async (): Promise<GetLastPricesResponse> => prices,
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

  it('резолвится по точному ISIN и не падает NOT_FOUND (K26)', async () => {
    // ISIN обыкновенных акций Сбера из фикстуры — раньше quote матчил только
    // по тикеру и падал, хотя bond/dividends по ISIN работали.
    const quotes = await getQuotes(apiWith(), 'RU0009029540');

    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ ticker: 'SBER', uid: 'uid-sber', price: 305.5 });
  });

  it('поддерживает индексы через индикативы (K44): quote IMOEX', async () => {
    const api = apiWith(
      findInstrumentResponseFixture, // для 'IMOEX' точных совпадений нет → fallback
      { lastPrices: [{ figi: 'IMOEX', instrumentUid: 'uid-imoex', price: { units: '2800', nano: 0 } }] },
      { instruments: [{ uid: 'uid-imoex', ticker: 'IMOEX', name: 'Индекс МосБиржи' }] },
    );

    const quotes = await getQuotes(api, 'IMOEX');
    expect(quotes[0]).toMatchObject({ ticker: 'IMOEX', uid: 'uid-imoex', price: 2800 });
  });

  it('без точного совпадения тикера/ISIN и не индекс — APP_TINVEST_INSTRUMENT_NOT_FOUND с подсказкой про search', async () => {
    const err = await getQuotes(apiWith(), 'сбербанк').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('APP_TINVEST_INSTRUMENT_NOT_FOUND');
    expect((err as AppError).userMessage).toContain('search');
  });

  it('запись без поля price не роняет команду: цена = null (не 0), инструмент показан', async () => {
    // Живой кейс: торги не идут → запись в lastPrices без price/time.
    const quotes = await getQuotes(
      apiWith(findInstrumentResponseFixture, pricelessLastPricesFixture),
      'SBERP',
    );

    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ ticker: 'SBERP', price: null, time: null });
  });

  it('если цены нет вовсе (пустой ответ) — цена = null, без исключения', async () => {
    const quotes = await getQuotes(apiWith(findInstrumentResponseFixture, emptyLastPricesFixture), 'SBER');

    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.price).toBeNull();
  });
});
