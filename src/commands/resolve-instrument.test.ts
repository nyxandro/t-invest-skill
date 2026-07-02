/**
 * Тесты резолвера инструмента: точное совпадение тикера/ISIN, приоритет
 * основной торговой сессии, фильтр по типу инструмента.
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../api/errors.js';
import type { FindInstrumentResponse, InstrumentShort } from '../api/types.js';
import { resolveInstrument } from './resolve-instrument.js';

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
