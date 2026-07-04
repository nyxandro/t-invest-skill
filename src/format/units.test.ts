/**
 * Тесты форматирования единиц цены: облигации/фьючерсы — в пунктах (с рублёвым
 * эквивалентом для облигаций), прочее — в валюте. Защита от путаницы «пункты ≠ рубли».
 */
import { describe, expect, it } from 'vitest';
import {
  POINT_PRICED_INSTRUMENT_TYPES,
  formatInstrumentPrice,
  formatMoneyAmount,
  priceUnitFor,
} from './units.js';

describe('priceUnitFor', () => {
  it('облигация/фьючерс → point, прочее → currency', () => {
    expect(priceUnitFor('bond')).toBe('point');
    expect(priceUnitFor('futures')).toBe('point');
    expect(priceUnitFor('share')).toBe('currency');
    expect(priceUnitFor('etf')).toBe('currency');
  });

  it('набор «пунктовых» типов — облигации и фьючерсы', () => {
    expect([...POINT_PRICED_INSTRUMENT_TYPES].sort()).toEqual(['bond', 'futures']);
  });
});

describe('formatInstrumentPrice', () => {
  it('пункты + номинал → метка «пт» и рублёвый эквивалент за штуку', () => {
    expect(formatInstrumentPrice(100.5, { unit: 'point', nominalRub: 1000 })).toBe(
      '100.50 пт (≈ 1 005.00 ₽/шт)',
    );
  });

  it('пункты без номинала (фьючерс/номинал не пришёл) → только метка «пт»', () => {
    expect(formatInstrumentPrice(100.5, { unit: 'point', nominalRub: null })).toBe('100.50 пт');
  });

  it('валюта с известным кодом → символ валюты', () => {
    expect(formatInstrumentPrice(96.9, { unit: 'currency', currency: 'rub' })).toBe('96.90 ₽');
  });

  it('валюта без кода → просто число (не навязываем ₽)', () => {
    expect(formatInstrumentPrice(96.9, { unit: 'currency' })).toBe('96.90');
  });
});

describe('formatMoneyAmount', () => {
  it('рубли → символ ₽', () => {
    expect(formatMoneyAmount(1007.76, 'rub')).toBe('1 007.76 ₽');
  });

  it('сумма висящей заявки в пунктах (currency "pt.") → метка «пт»', () => {
    expect(formatMoneyAmount(100.82, 'pt.')).toBe('100.82 пт');
  });

  it('иная валюта → её символ', () => {
    expect(formatMoneyAmount(10, 'usd')).toBe('10.00 $');
  });

  it('валюта не пришла → просто число', () => {
    expect(formatMoneyAmount(1007.76, null)).toBe('1 007.76');
  });
});
