/**
 * Тесты команды search: маппинг результатов поиска инструментов;
 * пустой результат — валидный ответ (пустой список, не ошибка).
 */
import { describe, expect, it } from 'vitest';
import { findInstrumentResponseFixture } from '../api/mocks/market.fixture.js';
import { searchInstruments } from './search.js';

describe('searchInstruments', () => {
  it('маппит найденные инструменты в представление', async () => {
    const api = { findInstrument: async () => findInstrumentResponseFixture };
    const results = await searchInstruments(api, 'сбер');

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      ticker: 'SBER',
      name: 'Сбер Банк',
      instrumentType: 'share',
      classCode: 'TQBR',
      uid: 'uid-sber',
    });
  });

  it('пустой результат поиска — пустой список', async () => {
    const api = { findInstrument: async () => ({ instruments: [] }) };
    await expect(searchInstruments(api, 'zzzz')).resolves.toEqual([]);
  });
});
