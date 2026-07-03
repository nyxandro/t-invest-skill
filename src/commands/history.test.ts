/**
 * Тесты команды history: выбор интервала под лимиты API, статистика свечей
 * (изменение, диапазон, волатильность), ранняя валидация периода до сети.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../api/errors.js';
import { CANDLES_MONTH_MAX_DAYS } from '../config/config.js';
import {
  computeCandleStats,
  fetchHistory,
  pickCandleInterval,
  toCandleViews,
  type CandleView,
  type HistoryApi,
} from './history.js';

describe('pickCandleInterval', () => {
  it('подбирает самый детальный интервал под лимит запроса', () => {
    expect(pickCandleInterval(1)).toBe('CANDLE_INTERVAL_HOUR');
    expect(pickCandleInterval(30)).toBe('CANDLE_INTERVAL_DAY');
    expect(pickCandleInterval(366)).toBe('CANDLE_INTERVAL_DAY');
    expect(pickCandleInterval(500)).toBe('CANDLE_INTERVAL_WEEK');
    expect(pickCandleInterval(2000)).toBe('CANDLE_INTERVAL_MONTH');
  });

  it('слишком глубокая история — явная ошибка', () => {
    expect(() => pickCandleInterval(5000)).toThrow(AppError);
  });
});

describe('computeCandleStats', () => {
  const candle = (close: number, low: number, high: number, volume = 100): CandleView => ({
    time: '2026-01-01T00:00:00Z',
    open: close,
    close,
    low,
    high,
    volume,
  });

  it('считает изменение, диапазон и позицию цены в диапазоне', () => {
    const stats = computeCandleStats(
      [candle(100, 95, 105), candle(110, 100, 115), candle(120, 110, 130)],
      'CANDLE_INTERVAL_DAY',
    );
    expect(stats.firstClose).toBe(100);
    expect(stats.lastClose).toBe(120);
    expect(stats.changePercent).toBe(20);
    expect(stats.minLow).toBe(95);
    expect(stats.maxHigh).toBe(130);
    // (120 - 95) / (130 - 95) = 71.43%
    expect(stats.positionInRangePercent).toBeCloseTo(71.43, 1);
    expect(stats.avgVolume).toBe(100);
    expect(stats.annualizedVolatilityPercent).not.toBeNull();
  });

  it('пустой набор свечей — все метрики null, без исключений', () => {
    const stats = computeCandleStats([], 'CANDLE_INTERVAL_DAY');
    expect(stats.candlesCount).toBe(0);
    expect(stats.changePercent).toBeNull();
    expect(stats.positionInRangePercent).toBeNull();
    expect(stats.annualizedVolatilityPercent).toBeNull();
  });

  it('волатильность не аннуализируется для часовых свечей', () => {
    const stats = computeCandleStats(
      [candle(100, 99, 101), candle(101, 100, 102), candle(102, 101, 103)],
      'CANDLE_INTERVAL_HOUR',
    );
    expect(stats.annualizedVolatilityPercent).toBeNull();
  });
});

describe('toCandleViews', () => {
  it('конвертирует Quotation-поля и отсутствие данных в null', () => {
    const views = toCandleViews([
      {
        time: '2026-01-01T00:00:00Z',
        open: { units: '100', nano: 500000000 },
        close: { units: '101', nano: 0 },
        volume: '12345',
      },
    ]);
    expect(views[0]).toEqual({
      time: '2026-01-01T00:00:00Z',
      open: 100.5,
      high: null,
      low: null,
      close: 101,
      volume: 12345,
    });
  });
});

describe('fetchHistory (K40)', () => {
  it('слишком большой --days падает APP_CLI_INVALID_ARGUMENT до любых сетевых вызовов', async () => {
    // Все методы API — шпионы: если валидация периода уедет после сети, тест
    // это поймает (какой-то из них окажется вызван).
    const api = {
      findInstrument: vi.fn(),
      getIndicatives: vi.fn(),
      getCandles: vi.fn(),
    } as unknown as HistoryApi;

    const err = await fetchHistory(api, {
      query: 'SBER',
      days: CANDLES_MONTH_MAX_DAYS + 1,
      now: new Date('2026-07-02T00:00:00Z'),
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('APP_CLI_INVALID_ARGUMENT');
    expect(api.findInstrument).not.toHaveBeenCalled();
    expect(api.getIndicatives).not.toHaveBeenCalled();
    expect(api.getCandles).not.toHaveBeenCalled();
  });
});
