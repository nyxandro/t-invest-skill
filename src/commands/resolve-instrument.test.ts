/**
 * Тесты резолвера инструмента: точное совпадение тикера/ISIN, приоритет
 * основной торговой сессии, фильтр по типу инструмента, а также рыночный
 * резолвер с fallback на индикативные инструменты (индексы).
 */
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../api/errors.js';
import type { FindInstrumentResponse, InstrumentShort } from '../api/types.js';
import {
  resolveInstrument,
  resolveMarketInstrument,
  type MarketInstrumentApi,
} from './resolve-instrument.js';

function instrument(overrides: Partial<InstrumentShort>): InstrumentShort {
  return {
    uid: 'uid-1',
    figi: 'FIGI1',
    ticker: 'TEST',
    classCode: 'TQBR',
    isin: 'RU000TEST',
    instrumentType: 'share',
    name: 'Тест',
    ...overrides,
  };
}

function apiWith(instruments: InstrumentShort[]) {
  return {
    findInstrument: async (): Promise<FindInstrumentResponse> => ({ instruments }),
  };
}

describe('resolveInstrument', () => {
  it('находит по точному ISIN без учёта регистра', async () => {
    const resolved = await resolveInstrument(apiWith([instrument({})]), 'ru000test');
    expect(resolved.uid).toBe('uid-1');
  });

  it('из нескольких режимов торгов выбирает основную сессию', async () => {
    const resolved = await resolveInstrument(
      apiWith([
        instrument({ uid: 'uid-evening', classCode: 'SPEQ' }),
        instrument({ uid: 'uid-main', classCode: 'TQBR' }),
      ]),
      'TEST',
    );
    expect(resolved.uid).toBe('uid-main');
  });

  it('requireUnambiguous: несколько РАЗНЫХ выпусков с одним тикером → APP_TINVEST_INSTRUMENT_AMBIGUOUS (K47)', async () => {
    // Один тикер у двух разных эмитентов (разные ISIN) — для торговли молчаливый
    // выбор недопустим.
    const err = await resolveInstrument(
      apiWith([
        instrument({ uid: 'uid-a', classCode: 'TQBR', isin: 'RU000AAA' }),
        instrument({ uid: 'uid-b', classCode: 'SPBXM', isin: 'US000BBB' }),
      ]),
      'TEST',
      { requireUnambiguous: true },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('APP_TINVEST_INSTRUMENT_AMBIGUOUS');
  });

  it('requireUnambiguous: один выпуск на нескольких площадках (один ISIN) НЕ считается неоднозначным', async () => {
    const resolved = await resolveInstrument(
      apiWith([
        instrument({ uid: 'uid-main', classCode: 'TQBR', isin: 'RU000SAME' }),
        instrument({ uid: 'uid-evening', classCode: 'SPEQ', isin: 'RU000SAME' }),
      ]),
      'TEST',
      { requireUnambiguous: true },
    );
    expect(resolved.classCode).toBe('TQBR');
  });

  it('несовпадение типа инструмента — APP_TINVEST_WRONG_INSTRUMENT_TYPE', async () => {
    const err = await resolveInstrument(apiWith([instrument({})]), 'TEST', {
      instrumentType: 'bond',
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('APP_TINVEST_WRONG_INSTRUMENT_TYPE');
  });

  it('нет точного совпадения — APP_TINVEST_INSTRUMENT_NOT_FOUND с подсказкой', async () => {
    const err = await resolveInstrument(apiWith([instrument({})]), 'ТЕСТОВЫЙ ЗАВОД').catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('APP_TINVEST_INSTRUMENT_NOT_FOUND');
    expect((err as AppError).userMessage).toContain('search');
  });
});

describe('resolveMarketInstrument (K44)', () => {
  // Рыночный API: обычный инструмент SBER через FindInstrument и индекс IMOEX
  // только через Indicatives (как в реальном API).
  function marketApi(): MarketInstrumentApi {
    return {
      findInstrument: vi.fn(async (query: string): Promise<FindInstrumentResponse> => {
        if (query.trim().toUpperCase() === 'SBER') {
          return { instruments: [instrument({ uid: 'uid-sber', ticker: 'SBER' })] };
        }
        return { instruments: [] };
      }),
      getIndicatives: vi.fn(async () => ({
        instruments: [
          {
            uid: 'uid-imoex',
            ticker: 'IMOEX',
            name: 'Индекс МосБиржи',
            classCode: 'SPBXM',
            currency: 'rub',
            instrumentKind: 'INSTRUMENT_TYPE_INDEX',
          },
        ],
      })),
    };
  }

  it('обычный инструмент резолвится через FindInstrument, индикативы не запрашиваются', async () => {
    const api = marketApi();
    const resolved = await resolveMarketInstrument(api, 'SBER');
    expect(resolved).toMatchObject({ uid: 'uid-sber', ticker: 'SBER', kind: 'instrument' });
    // Обычный путь не должен трогать Indicatives — лишний сетевой вызов не нужен.
    expect(api.getIndicatives).not.toHaveBeenCalled();
  });

  it('находит IMOEX через индикативы, когда FindInstrument его не вернул', async () => {
    const api = marketApi();
    const resolved = await resolveMarketInstrument(api, 'IMOEX');
    expect(resolved).toMatchObject({
      uid: 'uid-imoex',
      ticker: 'IMOEX',
      name: 'Индекс МосБиржи',
      kind: 'indicative',
      instrumentType: 'INSTRUMENT_TYPE_INDEX',
      lot: null,
    });
  });

  it('неизвестный тикер — исходная ошибка «не найден» (после проверки индикативов)', async () => {
    const api = marketApi();
    await expect(resolveMarketInstrument(api, 'NOPE')).rejects.toMatchObject({
      code: 'APP_TINVEST_INSTRUMENT_NOT_FOUND',
    });
    expect(api.getIndicatives).toHaveBeenCalledTimes(1);
  });
});
