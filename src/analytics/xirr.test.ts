/**
 * Тесты XIRR: канонические случаи (год ровно, убыток), свойство NPV≈0
 * для найденной ставки, честный null на непригодных данных.
 */
import { describe, expect, it } from 'vitest';
import { computeXirrPercent, type CashFlow } from './xirr.js';

const flow = (iso: string, amount: number): CashFlow => ({ date: new Date(iso), amount });

// Контрольная NPV для проверки свойства «найденная ставка обнуляет NPV».
function npvAt(flows: CashFlow[], ratePercent: number): number {
  const t0 = Math.min(...flows.map((f) => f.date.getTime()));
  const msPerYear = 365 * 24 * 3600 * 1000;
  return flows.reduce(
    (sum, f) =>
      sum + f.amount / Math.pow(1 + ratePercent / 100, (f.date.getTime() - t0) / msPerYear),
    0,
  );
}

describe('computeXirrPercent', () => {
  it('вложение 1000 → 1100 ровно через год даёт 10%', () => {
    const rate = computeXirrPercent([
      flow('2025-01-01T00:00:00Z', -1000),
      flow('2026-01-01T00:00:00Z', 1100),
    ]);
    expect(rate).toBeCloseTo(10, 4);
  });

  it('убыточный портфель даёт отрицательную ставку', () => {
    const rate = computeXirrPercent([
      flow('2025-01-01T00:00:00Z', -1000),
      flow('2026-01-01T00:00:00Z', 900),
    ]);
    expect(rate).toBeCloseTo(-10, 4);
  });

  it('несколько пополнений и вывод: найденная ставка обнуляет NPV', () => {
    const flows = [
      flow('2024-01-01T00:00:00Z', -100000),
      flow('2024-07-01T00:00:00Z', -50000),
      flow('2025-03-01T00:00:00Z', 30000),
      flow('2026-01-01T00:00:00Z', 140000),
    ];
    const rate = computeXirrPercent(flows);
    expect(rate).not.toBeNull();
    // Свойство корня: NPV при найденной ставке практически ноль.
    expect(Math.abs(npvAt(flows, rate!))).toBeLessThan(0.01);
    // Диапазон здравого смысла: вложили 150 тыс., вернули 170 тыс. за 2 года.
    expect(rate!).toBeGreaterThan(0);
    expect(rate!).toBeLessThan(20);
  });

  it('null при однознаковых потоках', () => {
    expect(
      computeXirrPercent([flow('2025-01-01T00:00:00Z', -100), flow('2026-01-01T00:00:00Z', -100)]),
    ).toBeNull();
    expect(
      computeXirrPercent([flow('2025-01-01T00:00:00Z', 100), flow('2026-01-01T00:00:00Z', 100)]),
    ).toBeNull();
  });

  it('null при горизонте меньше суток (аннуализация бессмысленна)', () => {
    expect(
      computeXirrPercent([
        flow('2025-01-01T00:00:00Z', -100),
        flow('2025-01-01T10:00:00Z', 105),
      ]),
    ).toBeNull();
  });

  it('null при пустом или единственном потоке', () => {
    expect(computeXirrPercent([])).toBeNull();
    expect(computeXirrPercent([flow('2025-01-01T00:00:00Z', -100)])).toBeNull();
  });

  it('чередование вводов/выводов (несколько корней NPV): берётся корень на стороне прибыли', () => {
    // Живой кейс: депозиты и выводы вперемешку, итог прибыльный →
    // ставка обязана быть положительной (а не первый слева корень около -66%).
    const flows = [
      flow('2020-04-07T00:00:00Z', -50000),
      flow('2021-01-01T00:00:00Z', 120000),
      flow('2022-01-01T00:00:00Z', -80000),
      flow('2023-01-01T00:00:00Z', 60000),
      flow('2026-01-01T00:00:00Z', 20000),
    ];
    const rate = computeXirrPercent(flows);
    expect(rate).not.toBeNull();
    expect(rate!).toBeGreaterThan(0);
    expect(Math.abs(npvAt(flows, rate!))).toBeLessThan(0.01);
  });

  it('чередование потоков с убыточным итогом даёт отрицательную ставку', () => {
    const flows = [
      flow('2020-01-01T00:00:00Z', -100000),
      flow('2021-01-01T00:00:00Z', 30000),
      flow('2022-01-01T00:00:00Z', -20000),
      flow('2026-01-01T00:00:00Z', 40000),
    ];
    const rate = computeXirrPercent(flows);
    expect(rate).not.toBeNull();
    expect(rate!).toBeLessThan(0);
    expect(Math.abs(npvAt(flows, rate!))).toBeLessThan(0.01);
  });
});
