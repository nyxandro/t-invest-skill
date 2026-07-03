import { describe, expect, it } from 'vitest';
import { barChart, brailleLineChart } from './charts.js';

// Диапазон непустых символов Брайля: пустая ячейка — U+2800 (⠀), поэтому
// «есть хотя бы одна точка» ловим начиная с U+2801.
const BRAILLE_NON_EMPTY = /[⠁-⣿]/;

describe('brailleLineChart', () => {
  it('строит график заданной высоты с осью Y и подписями min/max', () => {
    const out = brailleLineChart([1, 2, 3, 4, 5], {
      height: 4,
      width: 10,
      formatValue: (v) => v.toFixed(0),
    });
    const lines = out.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines.every((line) => line.includes('│'))).toBe(true);
    // Верхняя строка подписана максимумом, нижняя — минимумом.
    expect(lines[0]!.trimStart().startsWith('5')).toBe(true);
    expect(lines[3]!.trimStart().startsWith('1')).toBe(true);
    // Хотя бы одна реальная точка нарисована (график не пустой).
    expect(BRAILLE_NON_EMPTY.test(out)).toBe(true);
  });

  it('возрастающий ряд рисует линию снизу-слева вверх-направо', () => {
    const out = brailleLineChart([1, 2, 3, 4, 5, 6, 7, 8], {
      height: 4,
      width: 8,
      formatValue: (v) => v.toFixed(0),
    });
    const lines = out.split('\n');
    const cellsOf = (line: string) => line.slice(line.indexOf('│') + 1);
    // Низ-слева и верх-справа должны быть непусты — грубая инверсия оси это ловит.
    expect(BRAILLE_NON_EMPTY.test(cellsOf(lines[3]!).slice(0, 3))).toBe(true);
    expect(BRAILLE_NON_EMPTY.test(cellsOf(lines[0]!).slice(-3))).toBe(true);
  });

  it('пустой или одноточечный ряд — честное сообщение, а не выдуманный график', () => {
    expect(brailleLineChart([])).toBe('График недоступен: недостаточно точек данных.');
    expect(brailleLineChart([42])).toBe('График недоступен: недостаточно точек данных.');
  });

  it('плоский ряд (все значения равны) не даёт NaN', () => {
    const out = brailleLineChart([5, 5, 5, 5], { height: 4, width: 8 });
    expect(out).not.toContain('NaN');
    expect(out.split('\n')).toHaveLength(4);
  });

  it('игнорирует нечисловые точки (NaN/Infinity) при выборе диапазона', () => {
    const out = brailleLineChart([1, Number.NaN, 3, Number.POSITIVE_INFINITY, 5], {
      height: 3,
      width: 6,
      formatValue: (v) => v.toFixed(0),
    });
    const lines = out.split('\n');
    expect(lines[0]!.trimStart().startsWith('5')).toBe(true);
    expect(lines[lines.length - 1]!.trimStart().startsWith('1')).toBe(true);
  });
});

describe('barChart', () => {
  it('самый большой по модулю бар занимает всю ширину, значение — справа', () => {
    const out = barChart(
      [
        { label: 'A', value: 100, note: '100' },
        { label: 'B', value: 50, note: '50' },
      ],
      { width: 10 },
    );
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('█'.repeat(10)); // максимум → полная ширина
    expect(lines[0]).toContain('100');
    expect((lines[1]!.match(/█/g) ?? []).length).toBe(5); // половина от максимума
  });

  it('нулевое значение — без бара, крошечное ненулевое — минимум один символ', () => {
    const out = barChart(
      [
        { label: 'big', value: 1000, note: '1000' },
        { label: 'zero', value: 0, note: '0' },
        { label: 'tiny', value: 1, note: '1' },
      ],
      { width: 20 },
    );
    const [big, zero, tiny] = out.split('\n');
    expect((big!.match(/█/g) ?? []).length).toBe(20);
    expect(zero).not.toContain('█');
    expect((tiny!.match(/█/g) ?? []).length).toBe(1);
  });

  it('масштабирует длину по модулю значения (для P/L со знаком)', () => {
    const out = barChart(
      [
        { label: 'loss', value: -100, note: '−100' },
        { label: 'gain', value: 25, note: '+25' },
      ],
      { width: 8 },
    );
    const [loss, gain] = out.split('\n');
    expect((loss!.match(/█/g) ?? []).length).toBe(8);
    expect((gain!.match(/█/g) ?? []).length).toBe(2);
  });

  it('длинная подпись обрезается до ширины колонки', () => {
    const out = barChart([{ label: 'ОченьДлинныйТикер', value: 1, note: 'x' }], {
      labelWidth: 6,
      width: 4,
    });
    expect(out.startsWith('Очень…')).toBe(true);
  });

  it('пустой набор — честное сообщение', () => {
    expect(barChart([])).toBe('График недоступен: нет данных.');
  });
});
