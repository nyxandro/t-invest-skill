/**
 * Тесты команды signals: маппинг сигналов, резолв имён бумаг через
 * справочники, расчёт потенциала к начальной цене.
 */
import { describe, expect, it } from 'vitest';
import { buildSignalViews } from './signals.js';

const q = (value: number): { units: string; nano: number } => ({
  units: String(Math.trunc(value)),
  nano: Math.round((value % 1) * 1e9),
});

describe('buildSignalViews', () => {
  it('маппит сигнал с именем из справочника и потенциалом', () => {
    const views = buildSignalViews(
      [
        {
          signalId: 's-1',
          strategyId: 'st-1',
          strategyName: 'Аналитики БКС',
          instrumentUid: 'uid-ogkb',
          createDt: '2026-01-20T00:00:00Z',
          direction: 'SIGNAL_DIRECTION_SELL',
          initialPrice: q(0.3481),
          name: 'ОГК-2: один удачный год - не стратегия',
          targetPrice: q(0.16),
          endDt: '2027-01-20T00:00:00Z',
          probability: 59,
        },
      ],
      new Map([['uid-ogkb', { ticker: 'OGKB', name: 'ОГК-2' }]]),
    );
    expect(views[0]).toMatchObject({
      ticker: 'OGKB',
      instrumentName: 'ОГК-2',
      direction: 'sell',
      initialPrice: 0.3481,
      targetPrice: 0.16,
      probability: 59,
      createdAt: '2026-01-20',
      endsAt: '2027-01-20',
    });
    // (0.16 / 0.3481 - 1) × 100 ≈ -54.04%.
    expect(views[0]!.potentialPercent).toBeCloseTo(-54.04, 1);
  });

  it('бумага вне справочников — ticker null, сигнал не выбрасывается', () => {
    const views = buildSignalViews(
      [{ signalId: 's-2', instrumentUid: 'uid-unknown', direction: 'SIGNAL_DIRECTION_BUY' }],
      new Map(),
    );
    expect(views[0]).toMatchObject({ ticker: null, direction: 'buy', potentialPercent: null });
  });
});
