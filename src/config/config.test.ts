/**
 * Тесты режимов работы CLI (sandbox / readonly / full) и разрешения токенов.
 * Политика fail-fast: без токена не работаем, при нескольких настроенных
 * токенах режим не угадываем — требуем явный --mode.
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../api/errors.js';
import {
  T_INVEST_BASE_URL,
  T_INVEST_SANDBOX_BASE_URL,
  baseUrlForMode,
  parseMode,
  resolveModeAndToken,
  tokenAvailability,
} from './config.js';

// Хелпер: достаёт AppError из выброшенного исключения с проверкой типа.
function catchAppError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  return expect.unreachable('ожидался AppError') as never;
}

describe('resolveModeAndToken — явный режим', () => {
  it('возвращает токен выбранного режима', () => {
    expect(
      resolveModeAndToken({ T_INVEST_TOKEN_SANDBOX: 't.sb', T_INVEST_TOKEN_FULL: 't.full' }, 'sandbox'),
    ).toEqual({ mode: 'sandbox', token: 't.sb' });
  });

  it('без токена выбранного режима падает с именем нужной переменной', () => {
    const err = catchAppError(() => resolveModeAndToken({ T_INVEST_TOKEN_SANDBOX: 't.sb' }, 'readonly'));
    expect(err.code).toBe('APP_TINVEST_TOKEN_MISSING');
    expect(err.userMessage).toContain('T_INVEST_TOKEN_READONLY');
  });
});

describe('resolveModeAndToken — автоопределение', () => {
  it('единственный заполненный токен определяет режим', () => {
    expect(resolveModeAndToken({ T_INVEST_TOKEN_READONLY: 't.ro' })).toEqual({
      mode: 'readonly',
      token: 't.ro',
    });
  });

  it('несколько токенов без --mode → APP_TINVEST_MODE_AMBIGUOUS', () => {
    const err = catchAppError(() =>
      resolveModeAndToken({ T_INVEST_TOKEN_SANDBOX: 't.sb', T_INVEST_TOKEN_READONLY: 't.ro' }),
    );
    expect(err.code).toBe('APP_TINVEST_MODE_AMBIGUOUS');
    expect(err.userMessage).toContain('--mode');
  });

  it('ни одного токена → APP_TINVEST_TOKEN_MISSING', () => {
    const err = catchAppError(() => resolveModeAndToken({}));
    expect(err.code).toBe('APP_TINVEST_TOKEN_MISSING');
  });

  it('токен из пробелов считается отсутствующим', () => {
    const err = catchAppError(() => resolveModeAndToken({ T_INVEST_TOKEN_FULL: '   ' }));
    expect(err.code).toBe('APP_TINVEST_TOKEN_MISSING');
  });
});

describe('tokenAvailability', () => {
  it('показывает, какие режимы обеспечены токенами', () => {
    expect(
      tokenAvailability({ T_INVEST_TOKEN_SANDBOX: 't.sb', T_INVEST_TOKEN_READONLY: 't.ro' }),
    ).toEqual({ sandbox: true, readonly: true, full: false });
  });

  it('пробельный токен считается отсутствующим', () => {
    expect(tokenAvailability({ T_INVEST_TOKEN_FULL: '  ' })).toEqual({
      sandbox: false,
      readonly: false,
      full: false,
    });
  });
});

describe('parseMode', () => {
  it('принимает три допустимых режима', () => {
    expect(parseMode('sandbox')).toBe('sandbox');
    expect(parseMode('readonly')).toBe('readonly');
    expect(parseMode('full')).toBe('full');
  });

  it('неизвестный режим → APP_CLI_INVALID_ARGUMENT', () => {
    const err = catchAppError(() => parseMode('prod'));
    expect(err.code).toBe('APP_CLI_INVALID_ARGUMENT');
  });
});

describe('baseUrlForMode', () => {
  it('sandbox ходит на контур песочницы, остальные — на основной', () => {
    expect(baseUrlForMode('sandbox')).toBe(T_INVEST_SANDBOX_BASE_URL);
    expect(baseUrlForMode('readonly')).toBe(T_INVEST_BASE_URL);
    expect(baseUrlForMode('full')).toBe(T_INVEST_BASE_URL);
  });
});
