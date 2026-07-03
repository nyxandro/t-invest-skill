/**
 * Активный режим сессии: персистентная «памятка», какой режим сейчас выбран.
 *
 * Это НЕ гейт денег и не крипто-замок — реальные сделки стережёт TradingGate
 * из окружения (см. config.ts / paths.ts). Задачи состояния:
 * 1. Обязательная инициализация: пока режим не выбран, команды с данными не
 *    выполняются (APP_TINVEST_SESSION_REQUIRED) — агент осознанно фиксирует режим.
 * 2. Восстановление после потери контекста: агент перечитывает активный режим
 *    из файла (через session status), а не помнит его в диалоге.
 * 3. Свободное явное переключение readonly ↔ sandbox ↔ full: смена — простая
 *    перезапись состояния (writeActiveMode), без «только через новую сессию».
 *
 * Путь файла состояния определяет идентичность сессии (см. session-identity.ts):
 * по TINVEST_SESSION_ID либо глобальный дефолт. Здесь функции работают с уже
 * разрешённым путём — так модуль чист от env/HOME и тестируется на реальной ФС.
 *
 * Экспорты:
 * - ActiveModeState — {mode, startedAt};
 * - readActiveMode(filePath) — прочитать состояние (null если нет; битый → ошибка);
 * - writeActiveMode(filePath, mode, now) — записать/перезаписать (смена свободна);
 * - clearActiveMode(filePath) — снять фиксацию режима (session end);
 * - resolveCommandMode(state, requestedMode?) — режим команды: требует активную
 *   сессию и запрещает молчаливое расхождение с явным --mode.
 */
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../api/errors.js';
import { T_INVEST_MODES, type TInvestMode } from './config.js';

export interface ActiveModeState {
  mode: TInvestMode;
  startedAt: string;
}

// Разбор файла состояния. Битый или с неизвестным режимом файл — не игнорируем
// молча (это часть защитного механизма выбора режима), а даём явную ошибку с
// подсказкой, как восстановиться.
function parseStateFile(filePath: string): ActiveModeState {
  let state: ActiveModeState;
  try {
    state = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ActiveModeState;
  } catch (cause) {
    throw new AppError({
      code: 'APP_TINVEST_SESSION_CORRUPT',
      userMessage: `Файл сессии повреждён: ${filePath}. Удалите его и заново выберите режим командой «session start».`,
      cause,
    });
  }
  if (!(T_INVEST_MODES as readonly string[]).includes(state?.mode)) {
    throw new AppError({
      code: 'APP_TINVEST_SESSION_CORRUPT',
      userMessage: `Файл сессии повреждён (неизвестный режим): ${filePath}. Удалите его и заново выберите режим.`,
    });
  }
  return state;
}

export function readActiveMode(filePath: string): ActiveModeState | null {
  // Отсутствие файла — штатная ситуация «режим ещё не выбран».
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return parseStateFile(filePath);
}

export function writeActiveMode(filePath: string, mode: TInvestMode, now: Date): ActiveModeState {
  // Смена режима — обычная перезапись: readonly/sandbox/full переключаются
  // свободно, без «только новая сессия». Права 0600 — состояние личное.
  const state: ActiveModeState = { mode, startedAt: now.toISOString() };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  return state;
}

export function clearActiveMode(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  fs.rmSync(filePath);
  return true;
}

// Режим для команды с данными: источник истины — активный режим сессии.
export function resolveCommandMode(
  state: ActiveModeState | null,
  requestedMode?: TInvestMode,
): TInvestMode {
  // Обязательный гейт инициализации: без выбранного режима команда не идёт.
  if (!state) {
    throw new AppError({
      code: 'APP_TINVEST_SESSION_REQUIRED',
      userMessage:
        'Режим работы не выбран. Сначала зафиксируйте его: «session start --mode readonly | sandbox | full» ' +
        '(по умолчанию — readonly). Пока режим не выбран, команды с данными не выполняются.',
    });
  }
  // Явный --mode не должен молча расходиться с активным режимом: переключение —
  // осознанное действие через session start, а не побочный эффект команды.
  if (requestedMode && requestedMode !== state.mode) {
    throw new AppError({
      code: 'APP_TINVEST_MODE_MISMATCH',
      userMessage:
        `Активный режим сессии — «${state.mode}», а команда запрошена в режиме «${requestedMode}». ` +
        `Смените режим явно: «session start --mode ${requestedMode}», затем повторите команду.`,
    });
  }
  return state.mode;
}
