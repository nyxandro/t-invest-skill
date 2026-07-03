/**
 * Каркас исполнения CLI-команд: окружение, границы ошибок и общие парсеры.
 *
 * Экспорты:
 * - bootstrapEnv() — загрузка .env ТОЛЬКО из ~/.config/tinvest/.env (детерминированно);
 * - printErrorAndExit(err) — единая граница ошибок (русское сообщение + код);
 * - runCommand(cmd, fn) — общий обработчик команды с API-клиентом:
 *   сессия → режим+токен → клиент нужного контура → бизнес-функция → вывод;
 * - runSessionCommand(cmd, fn) — обработчик команд session без API-клиента;
 * - parsePositiveInt(raw, optionName, max?) — валидация целочисленных опций;
 * - parsePositiveNumber(raw, optionName) — валидация числовых опций (цены);
 * - withChart(json, view, human, chart?) — единый способ приложить ASCII-график
 *   к выводу команды (в --json отдельным полем chart, иначе блоком снизу).
 */
import type { Command } from 'commander';
import dotenv from 'dotenv';
import fs from 'node:fs';
import { TInvestClient } from '../api/client.js';
import { AppError } from '../api/errors.js';
import {
  GLOBAL_ENV_PATH,
  baseUrlForMode,
  parseMode,
  resolveModeAndToken,
  resolveTradingGate,
  type TInvestMode,
  type TradingGate,
} from '../config/config.js';
import { activeModeStatePath } from '../config/session-identity.js';
import { readActiveMode, resolveCommandMode } from '../config/session.js';

// Загрузка окружения: .env читаем ТОЛЬКО из канонического пути
// (~/.config/tinvest/.env), не из cwd. Так детерминированно и безопасно —
// случайный ./.env в рабочей папке не перекроет и не скроет настроенные токены.
// Реальные переменные окружения имеют приоритет (dotenv не перезаписывает уже
// заданные) — штатный способ передать секреты в CI/контейнере.
export function bootstrapEnv(): void {
  if (fs.existsSync(GLOBAL_ENV_PATH)) {
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

// Общий каркас команды: обязательная активная сессия → режим и токен (fail-fast)
// → гейт торговли из окружения → клиент нужного контура → бизнес-функция → вывод.
// Баннеры (песочница, stonks) уходят в stderr, чтобы не портить --json.
export async function runCommand(
  cmd: Command,
  fn: (
    client: TInvestClient,
    json: boolean,
    mode: TInvestMode,
    tradingGate: TradingGate,
  ) => Promise<unknown>,
): Promise<void> {
  try {
    const { json, mode: rawMode } = cmd.optsWithGlobals<{ json?: boolean; mode?: string }>();
    const requestedMode = rawMode ? parseMode(rawMode) : undefined;
    // Обязательный гейт инициализации и источник истины по режиму — активная
    // сессия (файл состояния текущей идентичности). Без выбранного режима команда
    // не идёт (SESSION_REQUIRED); явный --mode не должен молча расходиться с ним.
    const state = readActiveMode(activeModeStatePath(process.env));
    const mode = resolveCommandMode(state, requestedMode);
    const { token } = resolveModeAndToken(process.env, mode);
    // Гейт реальных сделок вычисляется из окружения и передаётся команде: сам он
    // определяет, можно ли мутации и нужно ли подтверждение (см. assertMutationAllowed).
    const tradingGate = resolveTradingGate(process.env);
    if (mode === 'sandbox') {
      console.error('Режим песочницы: счёт и данные виртуальные.');
    }
    if (mode === 'full' && tradingGate.stonksMode) {
      console.error('⚠️ STONKS-режим: сделки реальными деньгами выполняются БЕЗ подтверждений.');
    }
    const client = new TInvestClient({ token, baseUrl: baseUrlForMode(mode) });
    const result = await fn(client, Boolean(json), mode, tradingGate);
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

// Единый способ приложить ASCII-график (флаг --chart) к выводу команды:
// в --json график уходит отдельным строковым полем `chart` (агент вставляет его
// в ответ дословно), в человекочитаемый вывод — блоком снизу. chart === undefined
// (флаг не передан) означает «вывод без изменений» — прежнее поведение команды.
export function withChart(
  json: boolean,
  view: object,
  human: string,
  chart: string | undefined,
): unknown {
  if (chart === undefined) {
    return json ? view : human;
  }
  return json ? { ...view, chart } : `${human}\n\n${chart}`;
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
