/**
 * Тесты идентичности сессии: путь состояния по TINVEST_SESSION_ID vs глобальный
 * дефолт и санитизация произвольного идентификатора в безопасное имя файла.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError } from '../api/errors.js';
import {
  GLOBAL_STATE_PATH,
  SESSIONS_DIR,
  activeModeStatePath,
  sanitizeSessionId,
} from './session-identity.js';

describe('sanitizeSessionId', () => {
  it('оставляет безопасные символы как есть', () => {
    expect(sanitizeSessionId('agent-42_v1.0')).toBe('agent-42_v1.0');
  });

  it('заменяет слэши и прочее на подчёркивания (нет обхода каталога)', () => {
    expect(sanitizeSessionId('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(sanitizeSessionId('a b/c:d')).toBe('a_b_c_d');
  });

  it('пустой или состоящий из точек id — явная ошибка', () => {
    expect(() => sanitizeSessionId('   ')).toThrowError(
      expect.objectContaining({ code: 'APP_TINVEST_SESSION_ID_INVALID' }),
    );
    expect(() => sanitizeSessionId('..')).toThrowError(AppError);
  });
});

describe('activeModeStatePath', () => {
  it('с TINVEST_SESSION_ID — файл под sessions/<id>.json', () => {
    const p = activeModeStatePath({ TINVEST_SESSION_ID: 'openclaw-1' });
    expect(p).toBe(path.join(SESSIONS_DIR, 'openclaw-1.json'));
  });

  it('без TINVEST_SESSION_ID — глобальный дефолт', () => {
    expect(activeModeStatePath({})).toBe(GLOBAL_STATE_PATH);
  });

  it('пробельный id считается незаданным (глобальный дефолт)', () => {
    expect(activeModeStatePath({ TINVEST_SESSION_ID: '   ' })).toBe(GLOBAL_STATE_PATH);
  });
});
