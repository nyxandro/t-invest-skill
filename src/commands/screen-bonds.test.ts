/**
 * Тесты скринера облигаций: статические фильтры (валюта, флаги, горизонт,
 * риск, оферта), приоритезация кандидатов и потолок.
 */
import { describe, expect, it } from 'vitest';
import type { BondListItem } from '../api/types-catalog.js';
import { defaultScreenBondsFilter, rankAndCapCandidates, staticFilterBonds } from './screen-bonds.js';

const now = new Date('2026-07-02T00:00:00Z');

const bond = (over: Partial<BondListItem>): BondListItem => ({
  uid: over.ticker ?? 'uid-x',
  ticker: 'BOND1',
  name: 'Выпуск',
  currency: 'rub',
  maturityDate: '2028-07-02T00:00:00Z',
  apiTradeAvailableFlag: true,
  ...over,
});

describe('staticFilterBonds', () => {
  const filter = defaultScreenBondsFilter();

  it('пропускает обычный рублёвый выпуск и режет валютные/флоатеры/амортизацию', () => {
    const items = [
      bond({ ticker: 'OK' }),
      bond({ ticker: 'USD', currency: 'usd' }),
      bond({ ticker: 'FLOAT', floatingCouponFlag: true }),
      bond({ ticker: 'AMORT', amortizationFlag: true }),
      bond({ ticker: 'PERP', perpetualFlag: true, maturityDate: undefined }),
      bond({ ticker: 'SUB', subordinatedFlag: true }),
      bond({ ticker: 'NOAPI', apiTradeAvailableFlag: false }),
    ];
    expect(staticFilterBonds(items, filter, now).map((b) => b.ticker)).toEqual(['OK']);
  });

  it('оферта: по умолчанию исключается, с includeOffer — считается к оферте', () => {
    const withOffer = bond({ ticker: 'OFFER', callDate: '2027-01-01T00:00:00Z' });
    expect(staticFilterBonds([withOffer], filter, now)).toEqual([]);
    const included = staticFilterBonds([withOffer], { ...filter, includeOffer: true }, now);
    expect(included.map((b) => b.ticker)).toEqual(['OFFER']);
  });

  it('окно срока: yearsMin/yearsMax по горизонту', () => {
    const items = [
      bond({ ticker: 'SHORT', maturityDate: '2026-10-01T00:00:00Z' }), // ~0.25 года
      bond({ ticker: 'MID', maturityDate: '2028-01-01T00:00:00Z' }), // ~1.5 года
      bond({ ticker: 'LONG', maturityDate: '2033-01-01T00:00:00Z' }), // ~6.5 лет
    ];
    const filtered = staticFilterBonds(items, { ...filter, yearsMin: 1, yearsMax: 3 }, now);
    expect(filtered.map((b) => b.ticker)).toEqual(['MID']);
  });

  it('фильтр риска консервативен: без уровня риска бумага не проходит', () => {
    const items = [
      bond({ ticker: 'LOW', riskLevel: 'RISK_LEVEL_LOW' }),
      bond({ ticker: 'HIGH', riskLevel: 'RISK_LEVEL_HIGH' }),
      bond({ ticker: 'UNKNOWN' }),
    ];
    const filtered = staticFilterBonds(items, { ...filter, riskMax: 'moderate' }, now);
    expect(filtered.map((b) => b.ticker)).toEqual(['LOW']);
  });

  it('квальские бумаги — только с includeQual', () => {
    const qual = bond({ ticker: 'QUAL', forQualInvestorFlag: true });
    expect(staticFilterBonds([qual], filter, now)).toEqual([]);
    expect(staticFilterBonds([qual], { ...filter, includeQual: true, }, now).map((b) => b.ticker)).toEqual(['QUAL']);
  });
});

describe('rankAndCapCandidates', () => {
  it('ликвидные раньше неликвидных, внутри группы — ближние погашения', () => {
    const items = [
      bond({ ticker: 'FAR-LIQ', maturityDate: '2030-01-01T00:00:00Z', liquidityFlag: true }),
      bond({ ticker: 'NEAR-NOLIQ', maturityDate: '2027-01-01T00:00:00Z' }),
      bond({ ticker: 'NEAR-LIQ', maturityDate: '2027-06-01T00:00:00Z', liquidityFlag: true }),
    ];
    const ranked = rankAndCapCandidates(items, 2);
    expect(ranked.map((b) => b.ticker)).toEqual(['NEAR-LIQ', 'FAR-LIQ']);
  });
});
