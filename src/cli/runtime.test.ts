/**
 * Тесты строгой валидации числовых опций CLI (лоты, суммы, цены).
 *
 * Денежный CLI обязан читать количество/цену БУКВАЛЬНО: голый Number() молча
 * принимает научную/hex/двоичную запись («1e3» → 1000, «0x0A» → 10) и знаки,
 * из-за чего опечатка могла бы превратиться в заявку на неожиданный объём.
 * Здесь фиксируем, что такие форматы отклоняются со стабильным кодом ошибки,
 * а нормальные десятичные значения проходят.
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../api/errors.js';
import { parsePositiveInt, parsePositiveNumber } from './runtime.js';

// Утилита: перехватывает выброшенный AppError и возвращает его код (иначе —
// проваливаем тест явным сообщением, чтобы не сравнивать с undefined).
function expectAppErrorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) {
      return err.code;
    }
    throw err;
  }
  throw new Error('Ожидался AppError, но исключение не выброшено');
}

describe('parsePositiveInt', () => {
  it('принимает обычные десятичные целые', () => {
    expect(parsePositiveInt('5', '--lots')).toBe(5);
    expect(parsePositiveInt('1000', '--lots')).toBe(1000);
    // Ведущие нули безвредны: значение по-прежнему буквальное.
    expect(parsePositiveInt('007', '--lots')).toBe(7);
  });

  it('обрезает окружающие пробелы', () => {
    expect(parsePositiveInt('  5  ', '--lots')).toBe(5);
  });

  it('отклоняет научную/hex/двоичную запись (главный кейс)', () => {
    for (const raw of ['1e3', '1E3', '0x0A', '0b101', '0o17']) {
      expect(expectAppErrorCode(() => parsePositiveInt(raw, '--lots'))).toBe('APP_CLI_INVALID_ARGUMENT');
    }
  });

  it('отклоняет дробные, нулевые, отрицательные и знак «+»', () => {
    for (const raw of ['1.5', '0', '-3', '+5']) {
      expect(expectAppErrorCode(() => parsePositiveInt(raw, '--lots'))).toBe('APP_CLI_INVALID_ARGUMENT');
    }
  });

  it('отклоняет пустую строку, мусор и разделители разрядов', () => {
    for (const raw of ['', '   ', 'abc', '1_000', '1 000', '1,000', 'NaN', 'Infinity']) {
      expect(expectAppErrorCode(() => parsePositiveInt(raw, '--lots'))).toBe('APP_CLI_INVALID_ARGUMENT');
    }
  });

  it('отклоняет значения за пределами безопасного целого (теряется точность)', () => {
    expect(expectAppErrorCode(() => parsePositiveInt('99999999999999999999', '--lots'))).toBe(
      'APP_CLI_INVALID_ARGUMENT',
    );
  });

  it('уважает верхнюю границу max', () => {
    expect(parsePositiveInt('30', '--amount', 30)).toBe(30);
    expect(expectAppErrorCode(() => parsePositiveInt('31', '--amount', 30))).toBe('APP_CLI_INVALID_ARGUMENT');
  });
});

describe('parsePositiveNumber', () => {
  it('принимает обычные десятичные числа', () => {
    expect(parsePositiveNumber('305.5', '--price')).toBe(305.5);
    expect(parsePositiveNumber('100', '--price')).toBe(100);
    expect(parsePositiveNumber('0.07', '--price')).toBe(0.07);
  });

  it('обрезает окружающие пробелы', () => {
    expect(parsePositiveNumber('  0.5 ', '--price')).toBe(0.5);
  });

  it('отклоняет научную/hex запись (главный кейс)', () => {
    for (const raw of ['1e3', '1.5e2', '0x0A', 'Infinity', 'NaN']) {
      expect(expectAppErrorCode(() => parsePositiveNumber(raw, '--price'))).toBe('APP_CLI_INVALID_ARGUMENT');
    }
  });

  it('отклоняет нулевые, отрицательные, знак «+» и неполные дроби', () => {
    for (const raw of ['0', '0.0', '-1', '+1', '.5', '5.']) {
      expect(expectAppErrorCode(() => parsePositiveNumber(raw, '--price'))).toBe('APP_CLI_INVALID_ARGUMENT');
    }
  });

  it('отклоняет пустую строку, мусор и разделители разрядов', () => {
    for (const raw of ['', '   ', 'abc', '1_000', '1 000', '1,5']) {
      expect(expectAppErrorCode(() => parsePositiveNumber(raw, '--price'))).toBe('APP_CLI_INVALID_ARGUMENT');
    }
  });
});
