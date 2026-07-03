/**
 * Тесты скринера облигаций: статические фильтры (валюта, флаги, горизонт,
 * риск, оферта), приоритезация кандидатов и потолок.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  BondListItem,
  BondsResponse,
  EtfsResponse,
  SharesResponse,
} from '../api/types-catalog.js';
import type { GetBondCouponsResponse, GetLastPricesResponse } from '../api/types.js';
import {
  defaultScreenBondsFilter,
  rankAndCapCandidates,
  screenBonds,
  staticFilterBonds,
} from './screen-bonds.js';

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

describe('screenBonds — дисконтные (бескупонные) выпуски (K7)', () => {
  // Полный конвейер скринера пишет кэши на диск — гоняем во временном каталоге
  // и чистим после каждого теста, чтобы не задеть реальный ~/.config/tinvest.
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-bonds-test-'));
    // Скринер логирует прогресс фетча купонов в stderr — подавляем в тестах.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  // Мок API скринера: боевой каталог из переданных облигаций, заданные цены и
  // график купонов; акции/фонды для контракта CatalogApi возвращаем пустыми.
  const screenApi = (
    bonds: BondListItem[],
    prices: GetLastPricesResponse,
    coupons: GetBondCouponsResponse,
  ) => ({
    getBonds: async (): Promise<BondsResponse> => ({ instruments: bonds }),
    getShares: async (): Promise<SharesResponse> => ({ instruments: [] }),
    getEtfs: async (): Promise<EtfsResponse> => ({ instruments: [] }),
    getLastPrices: async (): Promise<GetLastPricesResponse> => prices,
    getBondCoupons: async (): Promise<GetBondCouponsResponse> => coupons,
  });

  it('бескупонная бумага (events пустой, есть nominal+maturity+price) попадает в выдачу с ненулевым YTM', async () => {
    // Дисконтная облигация: график купонов пуст, но цена 90% номинала и есть
    // дата погашения через ~2 года → доходность = дисконт цены к номиналу.
    const zero = bond({
      ticker: 'ZERO',
      uid: 'uid-zero',
      nominal: { units: '1000', nano: 0, currency: 'rub' },
      maturityDate: '2028-07-02T00:00:00Z',
      liquidityFlag: true,
    });
    const prices: GetLastPricesResponse = {
      lastPrices: [{ figi: 'FG-ZERO', instrumentUid: 'uid-zero', price: { units: '90', nano: 0 } }],
    };
    const api = screenApi([zero], prices, { events: [] });

    const view = await screenBonds(api, {
      filter: defaultScreenBondsFilter(),
      mode: 'sandbox',
      now,
      cacheDir,
    });

    // Раньше бумага отбраковывалась на `future.length === 0` — теперь считается.
    expect(view.computed).toBe(1);
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]!.ticker).toBe('ZERO');
    // Дисконт 900 → 1000 за ~2 года ≈ 5.4% годовых, но точно > 0.
    expect(view.rows[0]!.ytmPercent).toBeGreaterThan(0);
    expect(view.rows[0]!.ytmPercent).toBeCloseTo(5.4, 1);
  });
});
