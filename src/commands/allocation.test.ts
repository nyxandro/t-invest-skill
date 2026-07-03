/**
 * Тесты команды allocation: группировка по классам/секторам/валютам/странам,
 * веса долей, детект концентрации и предупреждения о позициях без цены.
 */
import { describe, expect, it } from 'vitest';
import type { InstrumentDetails, PortfolioPosition } from '../api/types.js';
import { buildAllocationView } from './allocation.js';

const position = (over: Partial<PortfolioPosition>): PortfolioPosition => ({
  figi: 'figi-x',
  instrumentUid: 'uid-x',
  instrumentType: 'share',
  quantity: { units: '10', nano: 0 },
  currentPrice: { currency: 'rub', units: '100', nano: 0 },
  ...over,
});

const details = (over: Partial<InstrumentDetails> & { uid: string }): InstrumentDetails => ({
  name: 'Инструмент',
  ...over,
});

describe('buildAllocationView', () => {
  it('группирует по классам, секторам, валютам и странам с весами', () => {
    // Портфель 10 000: акции 6 000 (энергетика 4 000 + ИТ 2 000), облигации 4 000.
    const positions = [
      position({ instrumentUid: 'u-gazp', ticker: 'GAZP', quantity: { units: '40', nano: 0 } }),
      position({ instrumentUid: 'u-yndx', ticker: 'YDEX', quantity: { units: '20', nano: 0 } }),
      position({
        instrumentUid: 'u-bond',
        ticker: 'RU000A1',
        instrumentType: 'bond',
        quantity: { units: '4', nano: 0 },
        currentPrice: { currency: 'rub', units: '1000', nano: 0 },
      }),
    ];
    const detailsByUid = new Map([
      ['u-gazp', details({ uid: 'u-gazp', sector: 'energy', countryOfRiskName: 'Россия' })],
      ['u-yndx', details({ uid: 'u-yndx', sector: 'it', countryOfRiskName: 'Россия' })],
      ['u-bond', details({ uid: 'u-bond', sector: 'financial', countryOfRiskName: 'Россия' })],
    ]);
    const view = buildAllocationView({
      accountId: 'acc-1',
      positions,
      detailsByUid,
      totalValue: 10000,
      currency: 'rub',
    });

    expect(view.byType).toEqual([
      { key: 'акции', value: 6000, weightPercent: 60 },
      { key: 'облигации', value: 4000, weightPercent: 40 },
    ]);
    expect(view.bySector[0]).toEqual({ key: 'energy', value: 4000, weightPercent: 40 });
    expect(view.byCurrency).toEqual([{ key: 'rub', value: 10000, weightPercent: 100 }]);
    expect(view.byCountry).toEqual([{ key: 'Россия', value: 10000, weightPercent: 100 }]);
    // GAZP 40% и RU000A1 40% — выше порога 20%, YDEX 20% — ровно на пороге.
    expect(view.concentration.map((c) => c.ticker)).toEqual(['GAZP', 'RU000A1', 'YDEX']);
    // Чисто рублёвый портфель не должен ложно помечаться мультивалютным.
    expect(view.warnings.some((w) => w.includes('мультивалют'))).toBe(false);
  });

  it('мультивалютный портфель: инвалютная позиция даёт предупреждение о неточных весах', () => {
    // Рублёвая позиция и позиция в USD (замещающая облигация / ГДР). totalValue
    // приходит в рублях, а стоимость USD-позиции считается в долларах — курса
    // пересчёта в ответе GetPortfolio нет, поэтому её вес занижен. K5: движок
    // обязан явно предупредить о мультивалютности, а не выдавать неверный вес.
    const positions = [
      position({ instrumentUid: 'u-rub', ticker: 'SBER', quantity: { units: '60', nano: 0 } }),
      position({
        instrumentUid: 'u-usd',
        ticker: 'RU000USDBOND',
        instrumentType: 'bond',
        quantity: { units: '10', nano: 0 },
        currentPrice: { currency: 'usd', units: '100', nano: 0 },
      }),
    ];
    const view = buildAllocationView({
      accountId: 'acc-1',
      positions,
      detailsByUid: new Map(),
      totalValue: 100000,
      currency: 'rub',
    });
    expect(view.warnings.some((w) => w.includes('мультивалют') && w.includes('USD'))).toBe(true);
  });

  it('позиция без текущей цены не учитывается и даёт предупреждение', () => {
    const positions = [
      position({ instrumentUid: 'u-1', ticker: 'AAA' }),
      position({ instrumentUid: 'u-2', ticker: 'BBB', currentPrice: undefined }),
    ];
    const view = buildAllocationView({
      accountId: 'acc-1',
      positions,
      detailsByUid: new Map(),
      totalValue: 1000,
      currency: 'rub',
    });
    expect(view.byType[0]?.value).toBe(1000);
    expect(view.warnings.some((w) => w.includes('BBB'))).toBe(true);
  });

  it('отсутствие сектора и страны — явные метки, а не пропуск позиции', () => {
    const positions = [position({ instrumentUid: 'u-1', ticker: 'AAA' })];
    const view = buildAllocationView({
      accountId: 'acc-1',
      positions,
      detailsByUid: new Map([['u-1', details({ uid: 'u-1' })]]),
      totalValue: 1000,
      currency: 'rub',
    });
    expect(view.bySector[0]?.key).toBe('без сектора');
    expect(view.byCountry[0]?.key).toBe('не указана');
  });

  it('валютные позиции получают сектор «валюта и кэш»', () => {
    const positions = [
      position({
        instrumentUid: 'u-rub',
        ticker: 'RUB000UTSTOM',
        instrumentType: 'currency',
        quantity: { units: '500', nano: 0 },
        currentPrice: { currency: 'rub', units: '1', nano: 0 },
      }),
    ];
    const view = buildAllocationView({
      accountId: 'acc-1',
      positions,
      detailsByUid: new Map(),
      totalValue: 500,
      currency: 'rub',
    });
    expect(view.byType[0]?.key).toBe('валюта и кэш');
    expect(view.bySector[0]?.key).toBe('валюта и кэш');
  });
});
