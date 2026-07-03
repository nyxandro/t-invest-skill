/**
 * Тесты московского форматирования дат: ключевой кейс — ночная/вечерняя
 * операция, у которой наивный UTC-срез уводит календарную дату на день назад.
 */
import { describe, expect, it } from 'vitest';
import { formatMoscowDate, formatMoscowDateTime } from './datetime.js';

describe('formatMoscowDateTime', () => {
  it('сдвигает UTC на +3 в пределах суток', () => {
    expect(formatMoscowDateTime('2026-07-02T10:30:00Z')).toBe('2026-07-02 13:30');
  });

  it('ночная сделка: 22:30 UTC → следующий день 01:30 МСК (дата НЕ уезжает назад)', () => {
    expect(formatMoscowDateTime('2026-07-02T22:30:00Z')).toBe('2026-07-03 01:30');
  });

  it('вечерняя сессия: 20:30 UTC → 23:30 МСК того же дня', () => {
    expect(formatMoscowDateTime('2026-07-02T20:30:00Z')).toBe('2026-07-02 23:30');
  });

  it('на неожиданном формате возвращает исходную строку, не роняя вывод', () => {
    expect(formatMoscowDateTime('нет даты')).toBe('нет даты');
  });
});

describe('formatMoscowDate', () => {
  it('дата в МСК с переходом через полночь', () => {
    expect(formatMoscowDate('2026-07-02T22:30:00Z')).toBe('2026-07-03');
  });

  it('дата-полночь UTC остаётся тем же днём (сдвиг в пределах утра МСК)', () => {
    expect(formatMoscowDate('2026-07-02T00:00:00Z')).toBe('2026-07-02');
  });
});
