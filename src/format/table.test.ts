/**
 * Тесты текстового рендера таблиц: выравнивание колонок по ширине
 * самой длинной ячейки, разделитель после заголовка.
 */
import { describe, expect, it } from 'vitest';
import { renderTable } from './table.js';

describe('renderTable', () => {
  it('выравнивает колонки по самой широкой ячейке', () => {
    const out = renderTable(
      ['Тикер', 'Цена'],
      [
        ['SBER', '305.50'],
        ['TMOS', '7.42'],
      ],
    );
    const lines = out.split('\n');

    // Заголовок, разделитель и две строки данных.
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('Тикер  Цена  ');
    expect(lines[1]).toBe('-----  ------');
    expect(lines[2]).toBe('SBER   305.50');
    expect(lines[3]).toBe('TMOS   7.42  ');
  });

  it('пустой список строк — только заголовок и разделитель', () => {
    const out = renderTable(['A'], []);
    expect(out.split('\n')).toHaveLength(2);
  });
});
