/**
 * Тесты замка сессии (якорная модель): жизненный цикл, изоляция параллельных
 * сессий, PID-reuse, уборка мёртвых замков, граница режимов.
 * Работают с реальной ФС во временном каталоге — код замка честно проверяется
 * без моков файловой системы.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProcessAnchor, ProcessProbe } from './process-anchor.js';
import {
  endSession,
  enforceSessionMode,
  assertFullAcknowledged,
  readSessionLock,
  sessionLockPath,
  startSession,
  sweepDeadSessions,
} from './session.js';

const now = new Date('2026-07-02T12:00:00Z');
const anchorA: ProcessAnchor = { pid: 111, startTicks: '500' };
const anchorB: ProcessAnchor = { pid: 222, startTicks: '700' };

describe('session lock (якорная модель)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinvest-session-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('start → read → end для одного якоря', () => {
    expect(readSessionLock(dir, anchorA)).toBeNull();
    const lock = startSession(dir, anchorA, 'sandbox', now);
    expect(lock).toMatchObject({ mode: 'sandbox', anchor: anchorA });
    expect(readSessionLock(dir, anchorA)).toMatchObject({ mode: 'sandbox' });
    expect(endSession(dir, anchorA)).toBe(true);
    expect(readSessionLock(dir, anchorA)).toBeNull();
  });

  it('смена режима при живом замке запрещена', () => {
    startSession(dir, anchorA, 'sandbox', now);
    expect(() => startSession(dir, anchorA, 'full', now)).toThrowError(
      expect.objectContaining({ code: 'APP_TINVEST_SESSION_ACTIVE' }),
    );
    // Тот же режим — идемпотентно.
    expect(() => startSession(dir, anchorA, 'sandbox', now)).not.toThrow();
  });

  it('параллельные сессии (разные якоря) не мешают друг другу', () => {
    startSession(dir, anchorA, 'readonly', now);
    startSession(dir, anchorB, 'sandbox', now);
    expect(readSessionLock(dir, anchorA)?.mode).toBe('readonly');
    expect(readSessionLock(dir, anchorB)?.mode).toBe('sandbox');
  });

  it('PID-reuse: замок с другим временем старта процесса отбрасывается', () => {
    startSession(dir, anchorA, 'readonly', now);
    // Новая сессия получила тот же PID, но процесс другой (иные тики).
    const reusedPid: ProcessAnchor = { pid: 111, startTicks: '9999' };
    expect(readSessionLock(dir, reusedPid)).toBeNull();
    // Файл мёртвого замка при этом удалён.
    expect(fs.existsSync(sessionLockPath(dir, 111))).toBe(false);
  });

  it('повреждённый файл замка текущего якоря — явная ошибка', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(sessionLockPath(dir, anchorA.pid), '{битый json');
    expect(() => readSessionLock(dir, anchorA)).toThrowError(
      expect.objectContaining({ code: 'APP_TINVEST_SESSION_CORRUPT' }),
    );
  });

  it('sweepDeadSessions удаляет замки умерших процессов и битые файлы', () => {
    startSession(dir, anchorA, 'readonly', now);
    startSession(dir, anchorB, 'sandbox', now);
    fs.writeFileSync(sessionLockPath(dir, 333), 'мусор');
    // Жив только якорь B.
    // Валидная позиция starttime — 20-я после «(comm)» (см. parseStat).
    const statTail = ['S', '1', ...Array<string>(17).fill('0'), anchorB.startTicks!, '0'].join(' ');
    const probe: ProcessProbe = {
      selfPid: 1,
      readStat: (pid) => (pid === anchorB.pid ? `${pid} (x) ${statTail}` : null),
      readCmdline: () => null,
      isAlive: (pid) => pid === anchorB.pid,
    };
    // legacy-путь уводим во временный каталог — тест не касается реального HOME.
    const removed = sweepDeadSessions(dir, probe, path.join(dir, 'legacy-session.json'));
    expect(removed).toBe(2); // мёртвый A + битый 333
    expect(fs.existsSync(sessionLockPath(dir, anchorA.pid))).toBe(false);
    expect(readSessionLock(dir, anchorB)?.mode).toBe('sandbox');
  });

  it('sweep удаляет артефакт старой TTL-схемы (миграция)', () => {
    const legacyPath = path.join(dir, 'legacy-session.json');
    fs.writeFileSync(legacyPath, JSON.stringify({ mode: 'readonly', expiresAt: '2026-07-03' }));
    const probe: ProcessProbe = { selfPid: 1, readStat: () => null, readCmdline: () => null, isAlive: () => false };
    expect(sweepDeadSessions(dir, probe, legacyPath)).toBe(1);
    expect(fs.existsSync(legacyPath)).toBe(false);
  });
});

describe('enforceSessionMode', () => {
  const lock = { mode: 'sandbox' as const, startedAt: now.toISOString(), anchor: anchorA };

  it('без замка возвращает запрошенный режим', () => {
    expect(enforceSessionMode(null, 'full')).toBe('full');
    expect(enforceSessionMode(null, undefined)).toBeUndefined();
  });

  it('чужой режим при замке — APP_TINVEST_MODE_LOCKED', () => {
    expect(() => enforceSessionMode(lock, 'full')).toThrowError(
      expect.objectContaining({ code: 'APP_TINVEST_MODE_LOCKED' }),
    );
    expect(enforceSessionMode(lock, 'sandbox')).toBe('sandbox');
    expect(enforceSessionMode(lock, undefined)).toBe('sandbox');
  });
});

describe('assertFullAcknowledged', () => {
  it('full без подтверждения — ошибка; с подтверждением и для других режимов — нет', () => {
    expect(() => assertFullAcknowledged('full', false)).toThrowError(
      expect.objectContaining({ code: 'APP_TINVEST_FULL_ACK_REQUIRED' }),
    );
    expect(() => assertFullAcknowledged('full', true)).not.toThrow();
    expect(() => assertFullAcknowledged('sandbox', false)).not.toThrow();
  });
});
