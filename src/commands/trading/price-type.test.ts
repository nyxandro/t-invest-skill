/**
 * Тесты выбора типа цены заявки (priceType) по типу инструмента.
 * Критично для реальных заявок: неверный priceType по облигации отправляет
 * цену как валюту вместо пунктов → «price is outside the limits» и отклонение.
 */
import { describe, expect, it } from 'vitest';
import { priceTypeFor } from './price-type.js';

describe('priceTypeFor', () => {
  it('облигация → PRICE_TYPE_POINT (цена в пунктах, % номинала)', () => {
    expect(priceTypeFor('bond')).toBe('PRICE_TYPE_POINT');
  });

  it('фьючерс → PRICE_TYPE_POINT (цена в пунктах контракта)', () => {
    expect(priceTypeFor('futures')).toBe('PRICE_TYPE_POINT');
  });

  it('акция → PRICE_TYPE_CURRENCY (цена в валюте расчётов)', () => {
    expect(priceTypeFor('share')).toBe('PRICE_TYPE_CURRENCY');
  });

  it('фонд и валюта → PRICE_TYPE_CURRENCY', () => {
    expect(priceTypeFor('etf')).toBe('PRICE_TYPE_CURRENCY');
    expect(priceTypeFor('currency')).toBe('PRICE_TYPE_CURRENCY');
  });
});
