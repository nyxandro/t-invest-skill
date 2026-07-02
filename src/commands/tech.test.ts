/**
 * Тесты команды tech: извлечение последних значений индикаторов
 * и генерация нейтральных наблюдений по порогам.
 */
import { describe, expect, it } from 'vitest';
import type { GetTechAnalysisResponse } from '../api/types-market.js';
import { buildTechView } from './tech.js';

const q = (value: number): { units: string; nano: number } => ({
  units: String(Math.trunc(value)),
  nano: Math.round((value % 1) * 1e9),
});

const signalSeries = (...values: number[]): GetTechAnalysisResponse => ({
  technicalIndicators: values.map((v, i) => ({
    timestamp: `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    signal: q(v),
  })),
});

describe('buildTechView', () => {
  it('берёт последние значения и формирует наблюдения о перекупленности', () => {
    const view = buildTechView({
      ticker: 'SBER',
      name: 'Сбер Банк',
      lastPrice: 310,
      rsiResp: signalSeries(55, 65, 75.5),
      smaFastResp: signalSeries(290, 295, 300),
      smaSlowResp: signalSeries(280, 282, 285),
      macdResp: {
        technicalIndicators: [
          { timestamp: '2026-06-30T00:00:00Z', macd: q(2.5), signal: q(1.2) },
        ],
      },
    });
    expect(view.rsi).toBe(75.5);
    expect(view.smaFast).toBe(300);
    expect(view.smaSlow).toBe(285);
    expect(view.macd).toBe(2.5);
    expect(view.macdSignal).toBe(1.2);
    expect(view.observations.some((o) => o.includes('перекупленности'))).toBe(true);
    expect(view.observations.some((o) => o.includes('восходящая структура'))).toBe(true);
    expect(view.observations.some((o) => o.includes('на стороне роста'))).toBe(true);
  });

  it('перепроданность и нисходящая структура', () => {
    const view = buildTechView({
      ticker: 'X',
      name: 'X',
      lastPrice: 80,
      rsiResp: signalSeries(25),
      smaFastResp: signalSeries(100),
      smaSlowResp: signalSeries(110),
      macdResp: {
        technicalIndicators: [{ timestamp: '2026-06-30T00:00:00Z', macd: q(-1), signal: q(0) }],
      },
    });
    expect(view.observations.some((o) => o.includes('перепроданности'))).toBe(true);
    expect(view.observations.some((o) => o.includes('нисходящая структура'))).toBe(true);
    expect(view.observations.some((o) => o.includes('на стороне снижения'))).toBe(true);
  });

  it('пустые ответы API — null-значения без наблюдений и исключений', () => {
    const view = buildTechView({
      ticker: 'X',
      name: 'X',
      lastPrice: null,
      rsiResp: {},
      smaFastResp: {},
      smaSlowResp: {},
      macdResp: {},
    });
    expect(view.rsi).toBeNull();
    expect(view.macd).toBeNull();
    expect(view.observations).toEqual([]);
  });
});
