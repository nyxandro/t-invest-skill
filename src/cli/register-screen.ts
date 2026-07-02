/**
 * Регистрация команд скрининга.
 *
 * Экспорты:
 * - registerScreenCommands(program) — добавляет команды:
 *   screen bonds [фильтры] — скринер облигаций по YTM/сроку/риску;
 *   screen shares [фильтры] — скринер акций по фундаментальным метрикам.
 */
import type { Command } from 'commander';
import { AppError } from '../api/errors.js';
import {
  defaultScreenBondsFilter,
  renderScreenBonds,
  screenBonds,
} from '../commands/screen-bonds.js';
import {
  defaultScreenSharesFilter,
  renderScreenShares,
  screenShares,
  type ShareSortKey,
} from '../commands/screen-shares.js';
import { parsePositiveInt, parsePositiveNumber, runCommand } from './runtime.js';

// Валидация перечислений опций: явная ошибка вместо тихого игнорирования.
function parseEnumOption<T extends string>(raw: string, optionName: string, allowed: readonly T[]): T {
  if ((allowed as readonly string[]).includes(raw)) {
    return raw as T;
  }
  throw new AppError({
    code: 'APP_CLI_INVALID_ARGUMENT',
    userMessage: `Параметр ${optionName} принимает значения: ${allowed.join(', ')}; получено «${raw}».`,
  });
}

export function registerScreenCommands(program: Command): void {
  const screen = program.command('screen').description('скринеры по всему справочнику инструментов');

  screen
    .command('bonds')
    .description('скринер облигаций: YTM, срок, риск (флоатеры/амортизация исключены)')
    .option('--ytm-min <pct>', 'минимальная доходность к погашению, %')
    .option('--years-min <n>', 'минимальный срок до погашения/оферты, лет')
    .option('--years-max <n>', 'максимальный срок до погашения/оферты, лет')
    .option('--risk-max <level>', 'максимальный уровень риска: low | moderate | high')
    .option('--include-offer', 'включить выпуски с офертой (расчёт к оферте)')
    .option('--include-qual', 'включить бумаги «только для квалов»')
    .option('--currency <code>', 'валюта номинала', 'rub')
    .option('--top <n>', 'сколько лучших показать')
    .option('--max-candidates <n>', 'потолок кандидатов для расчёта YTM')
    .action(
      async (
        opts: {
          ytmMin?: string;
          yearsMin?: string;
          yearsMax?: string;
          riskMax?: string;
          includeOffer?: boolean;
          includeQual?: boolean;
          currency: string;
          top?: string;
          maxCandidates?: string;
        },
        cmd: Command,
      ) =>
        runCommand(cmd, async (client, json, mode) => {
          const filter = defaultScreenBondsFilter();
          filter.currency = opts.currency.toLowerCase();
          filter.ytmMin = opts.ytmMin !== undefined ? parsePositiveNumber(opts.ytmMin, '--ytm-min') : null;
          filter.yearsMin = opts.yearsMin !== undefined ? parsePositiveNumber(opts.yearsMin, '--years-min') : null;
          filter.yearsMax = opts.yearsMax !== undefined ? parsePositiveNumber(opts.yearsMax, '--years-max') : null;
          filter.riskMax =
            opts.riskMax !== undefined
              ? parseEnumOption(opts.riskMax, '--risk-max', ['low', 'moderate', 'high'] as const)
              : null;
          filter.includeOffer = Boolean(opts.includeOffer);
          filter.includeQual = Boolean(opts.includeQual);
          if (opts.top !== undefined) {
            filter.top = parsePositiveInt(opts.top, '--top');
          }
          if (opts.maxCandidates !== undefined) {
            filter.maxCandidates = parsePositiveInt(opts.maxCandidates, '--max-candidates');
          }
          const view = await screenBonds(client, { filter, mode, now: new Date() });
          return json ? view : renderScreenBonds(view);
        }),
    );

  screen
    .command('shares')
    .description('скринер акций: P/E, P/B, ROE, дивдоходность, сектор')
    .option('--pe-max <n>', 'максимальный P/E')
    .option('--pb-max <n>', 'максимальный P/B')
    .option('--roe-min <pct>', 'минимальный ROE, %')
    .option('--div-min <pct>', 'минимальная дивдоходность TTM, %')
    .option('--sector <name>', 'сектор (energy, financial, it, ...)')
    .option('--sort <key>', 'сортировка: pe | roe | div | cap', 'cap')
    .option('--currency <code>', 'валюта торгов', 'rub')
    .option('--top <n>', 'сколько показать')
    .action(
      async (
        opts: {
          peMax?: string;
          pbMax?: string;
          roeMin?: string;
          divMin?: string;
          sector?: string;
          sort: string;
          currency: string;
          top?: string;
        },
        cmd: Command,
      ) =>
        runCommand(cmd, async (client, json, mode) => {
          const filter = defaultScreenSharesFilter();
          filter.currency = opts.currency.toLowerCase();
          filter.peMax = opts.peMax !== undefined ? parsePositiveNumber(opts.peMax, '--pe-max') : null;
          filter.pbMax = opts.pbMax !== undefined ? parsePositiveNumber(opts.pbMax, '--pb-max') : null;
          filter.roeMin = opts.roeMin !== undefined ? parsePositiveNumber(opts.roeMin, '--roe-min') : null;
          filter.divMin = opts.divMin !== undefined ? parsePositiveNumber(opts.divMin, '--div-min') : null;
          filter.sector = opts.sector ?? null;
          filter.sort = parseEnumOption<ShareSortKey>(opts.sort, '--sort', ['pe', 'roe', 'div', 'cap']);
          if (opts.top !== undefined) {
            filter.top = parsePositiveInt(opts.top, '--top');
          }
          const view = await screenShares(client, { filter, mode, now: new Date() });
          return json ? view : renderScreenShares(view);
        }),
    );
}
