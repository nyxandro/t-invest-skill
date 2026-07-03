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
  moneyToNumberOrNull,
  numberToQuotation,
  quotationToNumber,
  quotationToNumberOrNull,
  round,
} from './money.js';

const NANO_PER_UNIT = 1_000_000_000;

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

describe('numberToQuotation', () => {
  it('конвертирует число в units/nano', () => {
    expect(numberToQuotation(305.5)).toEqual({ units: '305', nano: 500000000 });
  });

  it('переносит разряд, когда округление дробной части даёт nano = 1e9', () => {
    // 1.9999999999 → дробь округляется до 1_000_000_000, что нарушает контракт
    // |nano| ≤ 999_999_999: разряд обязан перенестись в units.
    const q = numberToQuotation(1.9999999999);
    expect(q).toEqual({ units: '2', nano: 0 });
    expect(Math.abs(q.nano)).toBeLessThan(NANO_PER_UNIT);
  });

  it('переносит разряд для отрицательных значений', () => {
    const q = numberToQuotation(-1.9999999999);
    expect(q).toEqual({ units: '-2', nano: 0 });
    expect(Math.abs(q.nano)).toBeLessThan(NANO_PER_UNIT);
  });

  it('устойчив к двоичным артефактам (0.1 + 0.2)', () => {
    expect(numberToQuotation(0.1 + 0.2)).toEqual({ units: '0', nano: 300000000 });
  });

  it('обратно к quotationToNumber на всём диапазоне (round-trip)', () => {
    for (const value of [0, 1, 305.5, 999.123456789, -12.5, 42.000000001]) {
      const q = numberToQuotation(value);
      expect(Math.abs(q.nano)).toBeLessThan(NANO_PER_UNIT);
      expect(quotationToNumber(q)).toBeCloseTo(value, 9);
    }
  });
});

describe('round', () => {
  it('округляет до двух знаков по умолчанию', () => {
    expect(round(1.235)).toBe(1.24);
    expect(round(1.234)).toBe(1.23);
  });

  it('поддерживает произвольную точность', () => {
    expect(round(1.23456, 4)).toBe(1.2346);
    expect(round(1.23456, 0)).toBe(1);
  });

  it('сохраняет ноль как ноль (без -0 артефактов)', () => {
    expect(round(0)).toBe(0);
  });
});

describe('quotationToNumberOrNull / moneyToNumberOrNull', () => {
  it('возвращают null для отсутствующего поля (protobuf опускает незаполненное)', () => {
    expect(quotationToNumberOrNull(undefined)).toBeNull();
    expect(moneyToNumberOrNull(undefined)).toBeNull();
  });

  it('конвертируют присутствующее значение', () => {
    expect(quotationToNumberOrNull({ units: '10', nano: 0 })).toBe(10);
    expect(moneyToNumberOrNull({ currency: 'usd', units: '10', nano: 0 })).toBe(10);
  });

  it('сохраняют настоящий ноль как 0, а не как null', () => {
    // Ключевое отличие от `q?.price ? ... : null`: значение {0,0} валидно.
    expect(quotationToNumberOrNull({ units: '0', nano: 0 })).toBe(0);
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
