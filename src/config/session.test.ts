/**
 * Тесты активного режима сессии: жизненный цикл (read/write/clear), свободное
 * переключение режима и разрешение режима команды (обязательная инициализация +
 * запрет молчаливого расхождения с --mode). Работают на реальной ФС во
 * временном каталоге — логика состояния проверяется без моков.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearActiveMode,
  readActiveMode,
  resolveCommandMode,
  writeActiveMode,
} from './session.js';

const now = new Date('2026-07-02T12:00:00Z');

describe('активный режим (файл состояния)', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinvest-session-test-'));
    file = path.join(dir, 'sub', 'active-mode.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('нет файла → null; write создаёт каталог и пишет; read возвращает состояние', () => {
    expect(readActiveMode(file)).toBeNull();
    const state = writeActiveMode(file, 'readonly', now);
    expect(state).toEqual({ mode: 'readonly', startedAt: now.toISOString() });
    expect(readActiveMode(file)).toEqual({ mode: 'readonly', startedAt: now.toISOString() });
    // Файл создан с приватными правами (личное состояние).
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('смена режима — свободная перезапись', () => {
    writeActiveMode(file, 'readonly', now);
    writeActiveMode(file, 'sandbox', now);
    expect(readActiveMode(file)?.mode).toBe('sandbox');
    writeActiveMode(file, 'full', now);
    expect(readActiveMode(file)?.mode).toBe('full');
  });

  it('clearActiveMode снимает фиксацию', () => {
    writeActiveMode(file, 'sandbox', now);
    expect(clearActiveMode(file)).toBe(true);
    expect(readActiveMode(file)).toBeNull();
    // Повторный clear — уже нечего снимать.
    expect(clearActiveMode(file)).toBe(false);
  });

  it('битый файл состояния — явная ошибка', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{битый json');
    expect(() => readActiveMode(file)).toThrowError(
      expect.objectContaining({ code: 'APP_TINVEST_SESSION_CORRUPT' }),
    );
  });

  it('неизвестный режим в файле — явная ошибка', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ mode: 'prod', startedAt: now.toISOString() }));
    expect(() => readActiveMode(file)).toThrowError(
      expect.objectContaining({ code: 'APP_TINVEST_SESSION_CORRUPT' }),
    );
  });
});

describe('resolveCommandMode', () => {
  const state = { mode: 'sandbox' as const, startedAt: now.toISOString() };

  it('без активного режима — APP_TINVEST_SESSION_REQUIRED', () => {
    expect(() => resolveCommandMode(null)).toThrowError(
      expect.objectContaining({ code: 'APP_TINVEST_SESSION_REQUIRED' }),
    );
    expect(() => resolveCommandMode(null, 'readonly')).toThrowError(
      expect.objectContaining({ code: 'APP_TINVEST_SESSION_REQUIRED' }),
    );
  });

  it('без --mode или с совпадающим --mode возвращает активный режим', () => {
    expect(resolveCommandMode(state)).toBe('sandbox');
    expect(resolveCommandMode(state, 'sandbox')).toBe('sandbox');
  });

  it('--mode, отличный от активного, — APP_TINVEST_MODE_MISMATCH', () => {
    expect(() => resolveCommandMode(state, 'full')).toThrowError(
      expect.objectContaining({ code: 'APP_TINVEST_MODE_MISMATCH' }),
    );
  });
});
