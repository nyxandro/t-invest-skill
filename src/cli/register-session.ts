/**
 * Регистрация команд управления активным режимом сессии и песочницей.
 *
 * Экспорты:
 * - registerSessionCommands(program) — добавляет команды:
 *   session start [--mode <m>] — зафиксировать активный режим (по умолчанию
 *     readonly); переключение свободно, повтор перезаписывает режим;
 *   session status — активный режим, доступность токенов и гейт торговли
 *     (единый источник правды для агента после потери контекста);
 *   session end — снять фиксацию режима;
 *   sandbox init [--amount N] — открыть и пополнить счёт в песочнице.
 */
import type { Command } from 'commander';
import { AppError } from '../api/errors.js';
import { formatMoney } from '../api/money.js';
import {
  DEFAULT_SANDBOX_PAYIN_RUB,
  GLOBAL_ENV_PATH,
  MAX_SANDBOX_PAYIN_RUB,
  parseMode,
  resolveModeAndToken,
  resolveTradingGate,
  tokenAvailability,
  type TradingGate,
} from '../config/config.js';
import { SESSION_ID_ENV_VAR, activeModeStatePath } from '../config/session-identity.js';
import { clearActiveMode, readActiveMode, writeActiveMode } from '../config/session.js';
import { parsePositiveInt, runCommand, runSessionCommand } from './runtime.js';

// Предупреждение stonks-режима — одно место истины (используют session start и
// session status). Агент показывает его пользователю один раз при активации.
const STONKS_WARNING =
  '⚠️ Включён stonks-режим (T_INVEST_STONKS_MODE): агент может совершать сделки реальными ' +
  'деньгами БЕЗ подтверждений. Вы передаёте полный автономный доступ к счёту — ответственность ' +
  'на вас, это небезопасно.';

// Строка про состояние реальных сделок для человекочитаемого вывода.
function tradingStatusLine(gate: TradingGate): string {
  if (gate.stonksMode) {
    return 'Реальные сделки: STONKS — выполняются БЕЗ подтверждений.';
  }
  if (gate.allowTrading) {
    return 'Реальные сделки: включены (каждая заявка требует --confirm).';
  }
  return 'Реальные сделки: выключены (в full доступно только чтение).';
}

export function registerSessionCommands(program: Command): void {
  const session = program
    .command('session')
    .description('фиксация активного режима на сессию (обязательна перед командами с данными)');

  session
    .command('start')
    .description('зафиксировать активный режим (по умолчанию readonly); переключение — этой же командой в любой момент')
    .action(async (_opts: unknown, cmd: Command) =>
      runSessionCommand(cmd, (json) => {
        // Режим приходит через глобальный -m/--mode. Без него дефолт — readonly
        // (самый безопасный: реальный счёт, но сделки технически невозможны).
        const { mode: rawMode } = cmd.optsWithGlobals<{ mode?: string }>();
        const mode = rawMode ? parseMode(rawMode) : 'readonly';
        // fail-fast: токен нужного режима обязан существовать до записи состояния.
        resolveModeAndToken(process.env, mode);
        const gate = resolveTradingGate(process.env);
        const state = writeActiveMode(activeModeStatePath(process.env), mode, new Date());
        if (json) {
          return {
            activeMode: state.mode,
            startedAt: state.startedAt,
            tradingAllowed: gate.allowTrading,
            stonksMode: gate.stonksMode,
          };
        }
        const lines = [
          `Активный режим зафиксирован: «${state.mode}». Переключить можно в любой момент: session start --mode <режим>.`,
        ];
        // Для full поясняем текущее состояние гейта реальных сделок.
        if (mode === 'full') {
          lines.push(gate.stonksMode ? STONKS_WARNING : tradingStatusLine(gate));
        }
        return lines.join('\n');
      }),
    );

  session
    .command('status')
    .description('показать активный режим, доступность токенов и состояние гейта торговли')
    .action(async (_opts: unknown, cmd: Command) =>
      runSessionCommand(cmd, (json) => {
        const state = readActiveMode(activeModeStatePath(process.env));
        // Доступность токенов нужна скиллу для «живого» списка режимов.
        const tokens = tokenAvailability(process.env);
        const gate = resolveTradingGate(process.env);
        const sessionId = process.env[SESSION_ID_ENV_VAR]?.trim() || null;
        const warning = gate.stonksMode ? STONKS_WARNING : null;
        if (json) {
          return {
            active: state !== null,
            activeMode: state?.mode ?? null,
            startedAt: state?.startedAt ?? null,
            sessionId,
            tokens,
            tradingAllowed: gate.allowTrading,
            stonksMode: gate.stonksMode,
            warning,
            tokenEnvPath: GLOBAL_ENV_PATH,
          };
        }
        const tokensLine = (Object.entries(tokens) as [string, boolean][])
          .map(([mode, ok]) => `${mode}: ${ok ? '✓' : '✗ (токен не настроен)'}`)
          .join(', ');
        const modeLine = state
          ? `Активный режим: «${state.mode}» (зафиксирован ${state.startedAt}).`
          : 'Активный режим не выбран — выполните «session start» (по умолчанию readonly).';
        // warning отфильтровываем: в человекочитаемом выводе он появляется только
        // когда включён stonks.
        return [modeLine, `Токены: ${tokensLine}`, tradingStatusLine(gate), warning, `Файл токенов: ${GLOBAL_ENV_PATH}`]
          .filter(Boolean)
          .join('\n');
      }),
    );

  session
    .command('end')
    .description('снять фиксацию активного режима (следующая команда потребует заново выбрать режим)')
    .action(async (_opts: unknown, cmd: Command) =>
      runSessionCommand(cmd, (json) => {
        const removed = clearActiveMode(activeModeStatePath(process.env));
        if (json) {
          return { ended: removed };
        }
        return removed
          ? 'Режим сброшен. Выберите новый командой «session start».'
          : 'Активного режима не было.';
      }),
    );

  const sandbox = program.command('sandbox').description('управление песочницей (виртуальный счёт)');

  sandbox
    .command('init')
    .description('открыть счёт в песочнице и пополнить его рублями')
    .option('--amount <rub>', 'сумма пополнения в рублях', String(DEFAULT_SANDBOX_PAYIN_RUB))
    .action(async (opts: { amount: string }, cmd: Command) =>
      runCommand(cmd, async (client, json, mode) => {
        // Команда меняет состояние песочницы — в других режимах она бессмысленна
        // и потенциально опасна, поэтому жёсткий guard.
        if (mode !== 'sandbox') {
          throw new AppError({
            code: 'APP_TINVEST_SANDBOX_ONLY',
            userMessage: 'Команда «sandbox init» доступна только в режиме песочницы. Зафиксируйте режим: session start --mode sandbox.',
          });
        }
        const amount = parsePositiveInt(opts.amount, '--amount', MAX_SANDBOX_PAYIN_RUB);
        const { accountId } = await client.openSandboxAccount();
        const { balance } = await client.sandboxPayIn(accountId, amount);
        return json
          ? { accountId, balance }
          : `Счёт песочницы открыт: ${accountId}\nБаланс после пополнения: ${formatMoney(balance)}`;
      }),
    );
}
