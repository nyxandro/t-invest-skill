/**
 * Тесты конвертации денежных примитивов T-Invest API (units/nano → number)
 * и форматирования сумм для вывода в таблицах CLI.
 */
import { describe, expect, it } from 'vitest';
import {
  currencySymbol,
  formatAmount,
  formatMoney,
  moneyToNumber,
  quotationToNumber,
} from './money.js';

describe('quotationToNumber', () => {
  it('складывает целую и дробную часть', () => {
    expect(quotationToNumber({ units: '305', nano: 500000000 })).toBe(305.5);
  });

  it('корректно обрабатывает отрицательные значения (units и nano отрицательные)', () => {
    expect(quotationToNumber({ units: '-12', nano: -500000000 })).toBe(-12.5);
  });

  it('работает с нулевой дробной частью', () => {
    expect(quotationToNumber({ units: '100', nano: 0 })).toBe(100);
  });

  it('работает с нулевой целой частью', () => {
    expect(quotationToNumber({ units: '0', nano: 250000000 })).toBe(0.25);
  });
});

describe('moneyToNumber', () => {
  it('конвертирует MoneyValue так же, как Quotation', () => {
    expect(moneyToNumber({ currency: 'rub', units: '1234', nano: 560000000 })).toBe(1234.56);
  });
});

describe('formatAmount', () => {
  it('разделяет тысячи пробелами и оставляет два знака после точки', () => {
    expect(formatAmount(1234567.891)).toBe('1 234 567.89');
  });

  it('форматирует отрицательные суммы', () => {
    expect(formatAmount(-1234.5)).toBe('-1 234.50');
  });

  it('форматирует малые суммы без группировки', () => {
    expect(formatAmount(7.42)).toBe('7.42');
  });
});

describe('currencySymbol', () => {
  it('знает основные валюты', () => {
    expect(currencySymbol('rub')).toBe('₽');
    expect(currencySymbol('usd')).toBe('$');
    expect(currencySymbol('eur')).toBe('€');
  });

  it('для неизвестной валюты возвращает код в верхнем регистре', () => {
    expect(currencySymbol('kzt')).toBe('KZT');
  });
});

describe('formatMoney', () => {
  it('склеивает сумму и символ валюты', () => {
    expect(formatMoney({ currency: 'rub', units: '1234', nano: 560000000 })).toBe('1 234.56 ₽');
  });
});
