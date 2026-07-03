/**
 * Регистрация команд управления сессией режима и песочницей.
 *
 * Экспорты:
 * - registerSessionCommands(program) — добавляет команды:
 *   session start --mode <m> [--acknowledge-trading] — зафиксировать режим;
 *   session status — активная сессия и доступность токенов;
 *   session end — снять фиксацию (выполняет пользователь, не агент);
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
  tokenAvailability,
} from '../config/config.js';
import { detectSessionAnchor } from '../config/process-anchor.js';
import {
  SESSION_LOCK_DIR,
  assertFullAcknowledged,
  endSession,
  isModeConflict,
  readSessionLock,
  startSession,
  sweepDeadSessions,
} from '../config/session.js';
import { parsePositiveInt, runCommand, runSessionCommand } from './runtime.js';

export function registerSessionCommands(program: Command): void {
  const session = program
    .command('session')
    .description('фиксация режима на сессию работы (граница режимов на уровне кода)');

  session
    .command('start')
    .description('зафиксировать режим до конца сессии (смена — только в новой сессии); режим задаётся глобальным флагом --mode')
    .option(
      '--acknowledge-trading',
      'обязательное подтверждение для режима full (доступ к торговым операциям реальными деньгами)',
    )
    .action(async (opts: { acknowledgeTrading?: boolean }, cmd: Command) =>
      runSessionCommand(cmd, (json) => {
        // Режим приходит через глобальный -m/--mode: локальная одноимённая опция
        // конфликтовала бы с глобальной (commander перехватывает значение).
        const { mode: rawMode } = cmd.optsWithGlobals<{ mode?: string }>();
        if (!rawMode) {
          throw new AppError({
            code: 'APP_CLI_INVALID_ARGUMENT',
            userMessage: 'Укажите режим сессии: tinvest session start --mode sandbox | readonly | full.',
          });
        }
        const mode = parseMode(rawMode);
        assertFullAcknowledged(mode, Boolean(opts.acknowledgeTrading));
        // Уборка замков умерших сессий + порядок проверок: сначала граница
        // сессии (главное защитное сообщение), затем fail-fast по токену —
        // и только потом запись замка.
        sweepDeadSessions(SESSION_LOCK_DIR);
        const anchor = detectSessionAnchor();
        const now = new Date();
        const active = readSessionLock(SESSION_LOCK_DIR, anchor);
        // Нет конфликта режима — проверяем токен (fail-fast) до записи замка.
        // При конфликте токен не трогаем: startSession выдаст главное сообщение
        // APP_TINVEST_SESSION_ACTIVE (единый предикат isModeConflict — там же).
        if (!isModeConflict(active, mode)) {
          resolveModeAndToken(process.env, mode);
        }
        const lock = startSession(SESSION_LOCK_DIR, anchor, mode, now);
        return json
          ? lock
          : `Сессия зафиксирована: режим «${lock.mode}» до закрытия текущей сессии Claude Code.\nКоманды других режимов будут отклоняться с кодом APP_TINVEST_MODE_LOCKED.`;
      }),
    );

  session
    .command('status')
    .description('показать активную сессию и доступность токенов по режимам')
    .action(async (_opts: unknown, cmd: Command) =>
      runSessionCommand(cmd, (json) => {
        sweepDeadSessions(SESSION_LOCK_DIR);
        const lock = readSessionLock(SESSION_LOCK_DIR, detectSessionAnchor());
        // Доступность токенов нужна скиллу для «живого» списка режимов:
        // предлагать пользователю только то, что реально настроено.
        const tokens = tokenAvailability(process.env);
        if (json) {
          return { active: lock !== null, session: lock, tokens, tokenEnvPath: GLOBAL_ENV_PATH };
        }
        const tokensLine = (Object.entries(tokens) as [string, boolean][])
          .map(([mode, ok]) => `${mode}: ${ok ? '✓' : '✗ (токен не настроен)'}`)
          .join(', ');
        const sessionLine = lock
          ? `Активная сессия: режим «${lock.mode}», начата ${lock.startedAt}, действует до закрытия сессии Claude Code.`
          : 'Активной сессии нет — режим не зафиксирован.';
        return `${sessionLine}\nТокены: ${tokensLine}\nФайл токенов: ${GLOBAL_ENV_PATH}`;
      }),
    );

  session
    .command('end')
    .description('снять замок текущей сессии вручную (обычно не нужно: замок умирает вместе с сессией)')
    .action(async (_opts: unknown, cmd: Command) =>
      runSessionCommand(cmd, (json) => {
        sweepDeadSessions(SESSION_LOCK_DIR);
        const removed = endSession(SESSION_LOCK_DIR, detectSessionAnchor());
        if (json) {
          return { ended: removed };
        }
        return removed
          ? 'Сессия завершена. Новый режим можно выбрать командой «session start».'
          : 'Активной сессии не было.';
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
            userMessage: 'Команда «sandbox init» доступна только в режиме песочницы. Запустите с --mode sandbox.',
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
