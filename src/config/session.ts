/**
 * Фиксация режима работы на сессию (session lock) — кодовая граница режимов.
 *
 * Замок привязан к процессу запущенной сессии Claude Code (см.
 * process-anchor.ts): жив процесс — действует замок, закрыл сессию — замок
 * автоматически недействителен, новая сессия заново выбирает режим.
 * Никаких TTL и обязательного «session end» для пользователя.
 * Это защита штатных путей (defense in depth), а не криптография: субъект
 * с полным доступом к ФС может удалить файл, но это уже явное действие.
 *
 * Экспорты:
 * - SessionLock — структура замка (mode, startedAt, anchor);
 * - SESSION_LOCK_DIR, LEGACY_SESSION_LOCK_PATH — расположение замков;
 * - sessionLockPath(dir, pid) — файл замка для якоря;
 * - readSessionLock(dir, anchor) — активный замок ТЕКУЩЕГО якоря (null, если
 *   нет; PID-reuse отбрасывается; повреждённый файл — явная ошибка);
 * - isModeConflict(active, mode) — единый предикат «запрошен чужой режим при
 *   живом замке» (используют и startSession, и регистрация команд);
 * - startSession(dir, anchor, mode, now) — создать замок; смена режима при
 *   живом замке запрещена;
 * - endSession(dir, anchor) — снять замок текущего якоря (ручной сброс);
 * - sweepDeadSessions(dir, probe?) — удалить замки умерших сессий и артефакт
 *   старой TTL-схемы;
 * - enforceSessionMode(lock, requestedMode) — граница режимов для команд;
 * - assertFullAcknowledged(mode, acknowledged) — подтверждение full-режима.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppError } from '../api/errors.js';
import { T_INVEST_MODES, type TInvestMode } from './config.js';
import {
  isAnchorAlive,
  systemProbe,
  type ProcessAnchor,
  type ProcessProbe,
} from './process-anchor.js';

export interface SessionLock {
  mode: TInvestMode;
  startedAt: string;
  anchor: ProcessAnchor;
}

// Каталог замков: по файлу на якорь — параллельные сессии Claude Code
// не конфликтуют (у каждой свой процесс и свой замок).
export const SESSION_LOCK_DIR = path.join(os.homedir(), '.config', 'tinvest', 'sessions');

// Файл старой схемы (единый замок с TTL 8 ч) — подлежит удалению при sweep.
export const LEGACY_SESSION_LOCK_PATH = path.join(os.homedir(), '.config', 'tinvest', 'session.json');

export function sessionLockPath(dir: string, pid: number): string {
  return path.join(dir, `session-${pid}.json`);
}

function parseLockFile(filePath: string): SessionLock {
  let lock: SessionLock;
  try {
    lock = JSON.parse(fs.readFileSync(filePath, 'utf8')) as SessionLock;
  } catch (cause) {
    // Повреждённый замок не игнорируем молча (это защитный механизм) —
    // явная ошибка с подсказкой, как восстановиться.
    throw new AppError({
      code: 'APP_TINVEST_SESSION_CORRUPT',
      userMessage: `Файл сессии повреждён: ${filePath}. Удалите его вручную и начните сессию заново командой «tinvest session start».`,
      cause,
    });
  }
  if (!T_INVEST_MODES.includes(lock.mode) || !lock.anchor || typeof lock.anchor.pid !== 'number') {
    throw new AppError({
      code: 'APP_TINVEST_SESSION_CORRUPT',
      userMessage: `Файл сессии повреждён (неизвестный режим или нет якоря процесса): ${filePath}. Удалите его вручную и начните сессию заново.`,
    });
  }
  return lock;
}

export function readSessionLock(dir: string, anchor: ProcessAnchor): SessionLock | null {
  const filePath = sessionLockPath(dir, anchor.pid);
  // Отсутствие файла — штатная ситуация (сессия не начата).
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const lock = parseLockFile(filePath);
  // PID переиспользован новой сессией (другое время старта процесса) —
  // это замок УМЕРШЕЙ сессии: убираем и работаем как без сессии.
  if (lock.anchor.startTicks !== anchor.startTicks) {
    fs.rmSync(filePath, { force: true });
    return null;
  }
  return lock;
}

// Единый предикат конфликта режима: запрошен режим, отличный от уже
// зафиксированного живым замком. Один источник правила для startSession и для
// регистрации команд — чтобы зеркальные проверки не разошлись при доработке.
export function isModeConflict(active: SessionLock | null, mode: TInvestMode): boolean {
  return active !== null && active.mode !== mode;
}

export function startSession(
  dir: string,
  anchor: ProcessAnchor,
  mode: TInvestMode,
  now: Date,
): SessionLock {
  const active = readSessionLock(dir, anchor);

  // Смена режима внутри живой сессии запрещена — в этом весь смысл замка.
  if (isModeConflict(active, mode)) {
    // Инвариант: конфликт ⇒ замок существует (active не null), поэтому доступ
    // к active.mode безопасен (boolean-предикат тип не сужает).
    throw new AppError({
      code: 'APP_TINVEST_SESSION_ACTIVE',
      userMessage:
        `Сессия уже зафиксирована в режиме «${active!.mode}». ` +
        'Смена режима — только в новой сессии: закройте текущую сессию Claude Code и откройте новую, ' +
        'режим будет выбран заново.',
    });
  }

  // Тот же режим — идемпотентно; новая сессия — создание замка.
  const lock: SessionLock = {
    mode,
    startedAt: active?.startedAt ?? now.toISOString(),
    anchor,
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionLockPath(dir, anchor.pid), `${JSON.stringify(lock, null, 2)}\n`, {
    mode: 0o600,
  });
  return lock;
}

export function endSession(dir: string, anchor: ProcessAnchor): boolean {
  const filePath = sessionLockPath(dir, anchor.pid);
  if (!fs.existsSync(filePath)) {
    return false;
  }
  fs.rmSync(filePath);
  return true;
}

// Уборка замков умерших сессий (и артефакта старой TTL-схемы). Вызывается
// из команд session — то есть как минимум при каждой активации скилла.
// legacyPath параметризован, чтобы тесты не касались реального HOME.
export function sweepDeadSessions(
  dir: string,
  probe: ProcessProbe = systemProbe,
  legacyPath: string = LEGACY_SESSION_LOCK_PATH,
): number {
  let removed = 0;
  if (fs.existsSync(legacyPath)) {
    fs.rmSync(legacyPath, { force: true });
    removed += 1;
  }
  if (!fs.existsSync(dir)) {
    return removed;
  }
  for (const name of fs.readdirSync(dir)) {
    if (!/^session-\d+\.json$/.test(name)) {
      continue; // чужие файлы не трогаем
    }
    const filePath = path.join(dir, name);
    let lock: SessionLock;
    try {
      lock = parseLockFile(filePath);
    } catch {
      // Битый замок мёртвой сессии мешал бы вечно — убираем при уборке.
      fs.rmSync(filePath, { force: true });
      removed += 1;
      continue;
    }
    if (!isAnchorAlive(lock.anchor, probe)) {
      fs.rmSync(filePath, { force: true });
      removed += 1;
    }
  }
  return removed;
}

export function enforceSessionMode(
  lock: SessionLock | null,
  requestedMode?: TInvestMode,
): TInvestMode | undefined {
  // Без активной сессии границы нет — работает обычное разрешение режима.
  if (!lock) {
    return requestedMode;
  }
  // Запрос чужого режима при активной сессии — нарушение границы, отказ кода.
  if (requestedMode && requestedMode !== lock.mode) {
    throw new AppError({
      code: 'APP_TINVEST_MODE_LOCKED',
      userMessage:
        `Нарушение границы режимов: сессия зафиксирована в режиме «${lock.mode}», ` +
        `команда в режиме «${requestedMode}» отклонена. Смена режима — только в новой сессии Claude Code: ` +
        'закройте текущую и откройте новую, режим будет выбран заново.',
    });
  }
  return lock.mode;
}

export function assertFullAcknowledged(mode: TInvestMode, acknowledged: boolean): void {
  // Полноправный токен = потенциальный доступ к торговым операциям реальными
  // деньгами. Требуем явное машинное подтверждение осознанного выбора.
  if (mode === 'full' && !acknowledged) {
    throw new AppError({
      code: 'APP_TINVEST_FULL_ACK_REQUIRED',
      userMessage:
        'Режим «full» использует полноправный токен с доступом к торговым операциям реальными деньгами. ' +
        'Подтвердите осознанный выбор флагом --acknowledge-trading при запуске «session start».',
    });
  }
}
