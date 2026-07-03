/**
 * Тесты команды signals: маппинг сигналов, резолв имён бумаг через
 * справочники, расчёт потенциала к начальной цене, ленивая параллельная
 * загрузка справочников (K35).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSignalViews, fetchSignals } from './signals.js';

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

describe('fetchSignals — ленивая параллельная загрузка справочников (K35)', () => {
  // Изолированный кэш каталогов, чтобы не читать/писать реальный ~/.config.
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinvest-signals-test-'));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('нет сигналов — справочники не грузятся вовсе (ранний выход)', async () => {
    // Счётчики обращений к спискам: должны остаться нулевыми.
    const catalogCalls = { shares: 0, bonds: 0, etfs: 0 };
    const api = {
      findInstrument: async () => {
        throw new Error('findInstrument не должен вызываться без --ticker');
      },
      getStrategies: async () => ({ strategies: [] }),
      getSignals: async () => ({ signals: [] }),
      getShares: async () => {
        catalogCalls.shares += 1;
        return { instruments: [] };
      },
      getBonds: async () => {
        catalogCalls.bonds += 1;
        return { instruments: [] };
      },
      getEtfs: async () => {
        catalogCalls.etfs += 1;
        return { instruments: [] };
      },
    };

    const views = await fetchSignals(api, { mode: 'readonly', now: new Date(), cacheDir });

    expect(views).toEqual([]);
    // Регрессия K35: раньше все три справочника грузились безусловно.
    expect(catalogCalls).toEqual({ shares: 0, bonds: 0, etfs: 0 });
  });

  it('при наличии сигналов грузит все три справочника параллельно и резолвит имена', async () => {
    // Отслеживаем одновременность загрузок: при Promise.all пик = 3,
    // при последовательном for-await был бы 1.
    let inFlight = 0;
    let maxInFlight = 0;
    async function trackedCatalog<T>(value: T): Promise<T> {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return value;
    }
    const api = {
      findInstrument: async () => {
        throw new Error('findInstrument не должен вызываться без --ticker');
      },
      getStrategies: async () => ({ strategies: [] }),
      getSignals: async () => ({
        signals: [{ signalId: 's-1', instrumentUid: 'share-1', direction: 'SIGNAL_DIRECTION_BUY' }],
      }),
      getShares: async () =>
        trackedCatalog({ instruments: [{ uid: 'share-1', ticker: 'SBER', name: 'Сбер Банк' }] }),
      getBonds: async () => trackedCatalog({ instruments: [] }),
      getEtfs: async () => trackedCatalog({ instruments: [] }),
    };

    const views = await fetchSignals(api, { mode: 'readonly', now: new Date(), cacheDir });

    expect(maxInFlight).toBe(3); // все три справочника загружаются одновременно
    expect(views[0]).toMatchObject({ ticker: 'SBER', instrumentName: 'Сбер Банк', direction: 'buy' });
  });
});
