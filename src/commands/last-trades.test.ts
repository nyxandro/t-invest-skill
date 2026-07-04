/**
 * Тесты команды last-trades: цена облигации в пунктах vs акции в валюте,
 * русские направления, время в МСК, пустая лента как валидные данные.
 */
import { describe, expect, it } from 'vitest';
import type { GetLastTradesResponse } from '../api/types-market.js';
import type { FindInstrumentResponse, InstrumentShort } from '../api/types.js';
import { fetchLastTrades, renderLastTrades, type LastTradesApi } from './last-trades.js';

const BOND: InstrumentShort = {
  uid: 'uid-bond',
  figi: 'BBG-BOND',
  ticker: 'BONDX',
  classCode: 'TQCB',
  isin: 'RU000A10DP93',
  instrumentType: 'bond',
  name: 'Тест-облигация',
  currency: 'rub',
};

const SHARE: InstrumentShort = {
  uid: 'uid-sber',
  figi: 'BBG004730N88',
  ticker: 'SBER',
  classCode: 'TQBR',
  isin: 'RU0007661625',
  instrumentType: 'share',
  name: 'Сбер Банк',
  currency: 'rub',
};

function makeApi(instrument: InstrumentShort, trades: GetLastTradesResponse): LastTradesApi {
  return {
    async findInstrument(): Promise<FindInstrumentResponse> {
      return { instruments: [instrument] };
    },
    async getIndicatives() {
      return { instruments: [] };
    },
    async getLastTrades() {
      return trades;
    },
  };
}

const NOW = new Date('2026-07-04T08:00:00Z');

describe('fetchLastTrades / renderLastTrades', () => {
  it('облигация: цена в пунктах, направление по-русски, время в МСК', async () => {
    const api = makeApi(BOND, {
      trades: [
        { direction: 'TRADE_DIRECTION_BUY', price: { units: '100', nano: 500000000 }, quantity: '3', time: '2026-07-04T07:00:00Z' },
        { direction: 'TRADE_DIRECTION_SELL', price: { units: '100', nano: 400000000 }, quantity: '1', time: '2026-07-04T07:01:00Z' },
      ],
    });
    const view = await fetchLastTrades(api, { query: 'BONDX', hours: 1, now: NOW });
    expect(view.priceUnit).toBe('point');
    expect(view.trades[0]).toMatchObject({ direction: 'покупка', price: 100.5, quantity: 3 });
    const text = renderLastTrades(view);
    expect(text).toContain('100.50 пт');
    expect(text).toContain('10:00'); // 07:00 UTC → 10:00 МСК
    expect(text).toContain('покупка');
  });

  it('акция: цена в валюте (₽), без пунктов', async () => {
    const api = makeApi(SHARE, {
      trades: [{ direction: 'TRADE_DIRECTION_BUY', price: { units: '300', nano: 0 }, quantity: '2', time: '2026-07-04T07:00:00Z' }],
    });
    const view = await fetchLastTrades(api, { query: 'SBER', hours: 1, now: NOW });
    expect(view.priceUnit).toBe('currency');
    expect(renderLastTrades(view)).toContain('300.00 ₽');
  });

  it('пустая лента — валидные данные, не ошибка', async () => {
    const view = await fetchLastTrades(makeApi(BOND, {}), { query: 'BONDX', hours: 1, now: NOW });
    expect(view.trades).toEqual([]);
    expect(renderLastTrades(view)).toMatch(/сделок нет/);
  });
});
