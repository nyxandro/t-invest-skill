/**
 * Тесты скринера акций: трактовка нулевых метрик как «нет данных»,
 * фильтры, сортировка с null в конце.
 */
import { describe, expect, it } from 'vitest';
import type { AssetFundamentals } from '../api/types.js';
import type { ShareListItem } from '../api/types-catalog.js';
import { defaultScreenSharesFilter, joinAndFilterShares } from './screen-shares.js';

const share = (ticker: string, assetUid: string, sector = 'energy'): ShareListItem => ({
  uid: `uid-${ticker}`,
  ticker,
  name: ticker,
  currency: 'rub',
  sector,
  assetUid,
  apiTradeAvailableFlag: true,
});

const fundamentals = (assetUid: string, over: Partial<AssetFundamentals>): AssetFundamentals => ({
  assetUid,
  ...over,
});

describe('joinAndFilterShares', () => {
  const filter = defaultScreenSharesFilter();

  it('фильтр по P/E требует наличия метрики: ноль = нет данных = не проходит', () => {
    const shares = [share('CHEAP', 'a1'), share('ZERO', 'a2'), share('EXPENSIVE', 'a3')];
    const byUid = new Map([
      ['a1', fundamentals('a1', { peRatioTtm: 3.5 })],
      ['a2', fundamentals('a2', { peRatioTtm: 0 })], // «нет данных»
      ['a3', fundamentals('a3', { peRatioTtm: 25 })],
    ]);
    const rows = joinAndFilterShares(shares, byUid, { ...filter, peMax: 5 });
    expect(rows.map((r) => r.ticker)).toEqual(['CHEAP']);
  });

  it('сортировка по дивдоходности: null в конце', () => {
    const shares = [share('NODATA', 'a1'), share('HIGH', 'a2'), share('LOW', 'a3')];
    const byUid = new Map([
      ['a2', fundamentals('a2', { dividendYieldDailyTtm: 12 })],
      ['a3', fundamentals('a3', { dividendYieldDailyTtm: 4 })],
    ]);
    const rows = joinAndFilterShares(shares, byUid, { ...filter, sort: 'div' });
    expect(rows.map((r) => r.ticker)).toEqual(['HIGH', 'LOW', 'NODATA']);
  });

  it('фильтр по сектору и ROE, капитализация в миллиардах', () => {
    const shares = [share('OIL', 'a1', 'energy'), share('BANK', 'a2', 'financial')];
    const byUid = new Map([
      ['a1', fundamentals('a1', { roe: 25, marketCapitalization: 5_500_000_000_000 })],
      ['a2', fundamentals('a2', { roe: 22 })],
    ]);
    const rows = joinAndFilterShares(shares, byUid, { ...filter, sector: 'energy', roeMin: 20 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ticker: 'OIL', roe: 25, marketCapBillions: 5500 });
  });

  it('строки без фундаментала не отфильтровываются, если фильтры по метрикам не заданы', () => {
    const rows = joinAndFilterShares([share('X', 'a-none')], new Map(), filter);
    expect(rows[0]).toMatchObject({ ticker: 'X', pe: null, roe: null });
  });

  it('сортировка по P/E — по возрастанию (дешевле лучше)', () => {
    const shares = [share('A', 'a1'), share('B', 'a2')];
    const byUid = new Map([
      ['a1', fundamentals('a1', { peRatioTtm: 10 })],
      ['a2', fundamentals('a2', { peRatioTtm: 3 })],
    ]);
    const rows = joinAndFilterShares(shares, byUid, { ...filter, sort: 'pe' });
    expect(rows.map((r) => r.ticker)).toEqual(['B', 'A']);
  });
});
