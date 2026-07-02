/**
 * Тесты команды reports: русские подписи периодов, сортировка,
 * признак «ожидается».
 */
import { describe, expect, it } from 'vitest';
import { buildReportsView } from './reports.js';

describe('buildReportsView', () => {
  const now = new Date('2026-07-02T00:00:00Z');

  it('сортирует события, подписывает периоды и помечает будущие', () => {
    const view = buildReportsView({
      ticker: 'GAZP',
      name: 'Газпром',
      from: '2026-01-01T00:00:00Z',
      to: '2026-12-31T00:00:00Z',
      events: [
        { reportDate: '2026-08-28T00:00:00Z', periodYear: 2026, periodNum: 2, periodType: 'PERIOD_TYPE_QUARTER' },
        { reportDate: '2026-05-29T00:00:00Z', periodYear: 2026, periodNum: 1, periodType: 'PERIOD_TYPE_QUARTER' },
        { reportDate: '2026-03-30T00:00:00Z', periodYear: 2025, periodType: 'PERIOD_TYPE_ANNUAL' },
      ],
      now,
    });
    expect(view.events.map((e) => e.periodLabel)).toEqual([
      '2025 год',
      '1 квартал 2026',
      '2 квартал 2026',
    ]);
    expect(view.events.map((e) => e.upcoming)).toEqual([false, false, true]);
  });

  it('события без даты отбрасываются', () => {
    const view = buildReportsView({
      ticker: 'X',
      name: 'X',
      from: '',
      to: '',
      events: [{ periodYear: 2026 }],
      now,
    });
    expect(view.events).toEqual([]);
  });
});
