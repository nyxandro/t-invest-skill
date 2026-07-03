/**
 * Каркас исполнения CLI-команд: окружение, границы ошибок и общие парсеры.
 *
 * Экспорты:
 * - bootstrapEnv() — загрузка .env (текущая папка → глобальный конфиг);
 * - printErrorAndExit(err) — единая граница ошибок (русское сообщение + код);
 * - runCommand(cmd, fn) — общий обработчик команды с API-клиентом:
 *   сессия → режим+токен → клиент нужного контура → бизнес-функция → вывод;
 * - runSessionCommand(cmd, fn) — обработчик команд session без API-клиента;
 * - parsePositiveInt(raw, optionName, max?) — валидация целочисленных опций;
 * - parsePositiveNumber(raw, optionName) — валидация числовых опций (цены).
 */
import type { Command } from 'commander';
import dotenv from 'dotenv';
import fs from 'node:fs';
import { TInvestClient } from '../api/client.js';
import { AppError } from '../api/errors.js';
import {
  GLOBAL_ENV_PATH,
  baseUrlForMode,
  hasAnyToken,
  parseMode,
  resolveModeAndToken,
  type TInvestMode,
} from '../config/config.js';
import { detectSessionAnchor } from '../config/process-anchor.js';
import {
  SESSION_LOCK_DIR,
  enforceSessionMode,
  readSessionLock,
  type SessionLock,
} from '../config/session.js';

// Загрузка окружения: .env текущей папки, затем — только если ни один токен
// ещё не найден — глобальный ~/.config/tinvest/.env (запуск из любой директории).
export function bootstrapEnv(): void {
  dotenv.config({ quiet: true });
  if (!hasAnyToken(process.env) && fs.existsSync(GLOBAL_ENV_PATH)) {
    dotenv.config({ path: GLOBAL_ENV_PATH, quiet: true });
  }
}

// Единая граница ошибок CLI: пользователю — русское сообщение и стабильный
// код; технические детали — только в stderr при TINVEST_DEBUG=1.
export function printErrorAndExit(err: unknown): never {
  if (err instanceof AppError) {
    console.error(`Ошибка: ${err.userMessage} [${err.code}]`);
    if (process.env.TINVEST_DEBUG) {
      console.error('Детали:', JSON.stringify(err.details ?? null), err.cause ?? '');
    }
  } else {
    console.error('Ошибка: Непредвиденная ошибка выполнения команды. Запустите с TINVEST_DEBUG=1 для деталей. [APP_UNEXPECTED]');
    if (process.env.TINVEST_DEBUG) {
      console.error(err);
    }
  }
  process.exit(1);
}

// Общий каркас команды: режим и токен (fail-fast) → клиент нужного контура →
// бизнес-функция → вывод. Баннер песочницы уходит в stderr, чтобы не портить --json.
export async function runCommand(
  cmd: Command,
  fn: (
    client: TInvestClient,
    json: boolean,
    mode: TInvestMode,
    sessionLock: SessionLock | null,
  ) => Promise<unknown>,
): Promise<void> {
  try {
    const { json, mode: rawMode } = cmd.optsWithGlobals<{ json?: boolean; mode?: string }>();
    const requestedMode = rawMode ? parseMode(rawMode) : undefined;
    // Кодовая граница режимов: живой замок текущей сессии Claude Code
    // переопределяет и запрещает «чужие» режимы независимо от того,
    // что попросили у агента. Замок — единый источник состояния сессии:
    // передаём его команде, чтобы торговые мутации могли требовать активную
    // full-сессию (см. assertMutationAllowed), а не только --confirm.
    const sessionLock = readSessionLock(SESSION_LOCK_DIR, detectSessionAnchor());
    const explicitMode = enforceSessionMode(sessionLock, requestedMode);
    const { mode, token } = resolveModeAndToken(process.env, explicitMode);
    if (mode === 'sandbox') {
      console.error('Режим песочницы: счёт и данные виртуальные.');
    }
    const client = new TInvestClient({ token, baseUrl: baseUrlForMode(mode) });
    const result = await fn(client, Boolean(json), mode, sessionLock);
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  } catch (err) {
    printErrorAndExit(err);
  }
}

// Обработчик команд session: без API-клиента, но с той же границей ошибок.
export async function runSessionCommand(cmd: Command, fn: (json: boolean) => unknown): Promise<void> {
  try {
    const { json } = cmd.optsWithGlobals<{ json?: boolean }>();
    const result = fn(Boolean(json));
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  } catch (err) {
    printErrorAndExit(err);
  }
}

// Валидация целочисленной опции CLI: положительное целое в пределах max.
export function parsePositiveInt(raw: string, optionName: string, max?: number): number {
  const value = Number(raw);
  const withinMax = max === undefined || value <= max;
  if (!Number.isInteger(value) || value <= 0 || !withinMax) {
    const range = max === undefined ? 'положительным целым числом' : `целым числом от 1 до ${max}`;
    throw new AppError({
      code: 'APP_CLI_INVALID_ARGUMENT',
      userMessage: `Параметр ${optionName} должен быть ${range}, получено «${raw}».`,
    });
  }
  return value;
}

// Валидация числовой опции CLI (цены, проценты): конечное положительное число.
export function parsePositiveNumber(raw: string, optionName: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError({
      code: 'APP_CLI_INVALID_ARGUMENT',
      userMessage: `Параметр ${optionName} должен быть положительным числом, получено «${raw}».`,
    });
  }
  return value;
}
