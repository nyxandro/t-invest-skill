/**
 * Тесты команды history: выбор интервала под лимиты API, статистика свечей
 * (изменение, диапазон, волатильность), резолв индикативных инструментов.
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../api/errors.js';
import {
  computeCandleStats,
  pickCandleInterval,
  resolveMarketInstrument,
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

describe('resolveMarketInstrument', () => {
  const api = {
    async findInstrument(query: string) {
      if (query === 'SBER') {
        return {
          instruments: [
            {
              uid: 'uid-sber',
              figi: 'BBG004730N88',
              ticker: 'SBER',
              classCode: 'TQBR',
              instrumentType: 'share',
              name: 'Сбер Банк',
            },
          ],
        };
      }
      return { instruments: [] };
    },
    async getIndicatives() {
      return {
        instruments: [{ uid: 'uid-imoex', ticker: 'IMOEX', name: 'Индекс МосБиржи' }],
      };
    },
    async getCandles() {
      return { candles: [] };
    },
  } as unknown as HistoryApi;

  it('находит обычный инструмент по точному тикеру', async () => {
    const resolved = await resolveMarketInstrument(api, 'SBER');
    expect(resolved).toMatchObject({ uid: 'uid-sber', kind: 'instrument' });
  });

  it('падает в индикативные инструменты для индексов', async () => {
    const resolved = await resolveMarketInstrument(api, 'IMOEX');
    expect(resolved).toMatchObject({ uid: 'uid-imoex', kind: 'indicative', name: 'Индекс МосБиржи' });
  });

  it('неизвестный тикер — исходная ошибка «не найден»', async () => {
    await expect(resolveMarketInstrument(api, 'NOPE')).rejects.toMatchObject({
      code: 'APP_TINVEST_INSTRUMENT_NOT_FOUND',
    });
  });
});
