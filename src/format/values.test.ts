/**
 * Тесты форматтеров «значение или прочерк»: ключевое — настоящий 0
 * форматируется как число, а прочерк ставится только при отсутствии данных.
 */
import { describe, expect, it } from 'vitest';
import { DASH, formatOrDash, moneyOrDash, percentOrDash } from './values.js';

describe('formatOrDash', () => {
  it('форматирует число с точностью по умолчанию', () => {
    expect(formatOrDash(1.234)).toBe('1.23');
  });

  it('ставит прочерк для null/undefined', () => {
    expect(formatOrDash(null)).toBe(DASH);
    expect(formatOrDash(undefined)).toBe(DASH);
  });

  it('настоящий 0 форматируется, а не превращается в прочерк', () => {
    expect(formatOrDash(0)).toBe('0.00');
  });
});

describe('percentOrDash', () => {
  it('добавляет знак процента без пробела', () => {
    expect(percentOrDash(12.345)).toBe('12.35%');
  });

  it('прочерк для отсутствующего значения', () => {
    expect(percentOrDash(null)).toBe(DASH);
  });
});

describe('moneyOrDash', () => {
  it('группирует разряды', () => {
    expect(moneyOrDash(1234567.8)).toBe('1 234 567.80');
  });

  it('прочерк для отсутствующего значения', () => {
    expect(moneyOrDash(null)).toBe(DASH);
  });
});
