/**
 * Регистрация базовых команд CLI: счета, портфель, котировки, поиск,
 * операции и аналитические карточки инструментов.
 *
 * Экспорты:
 * - registerCoreCommands(program) — добавляет команды:
 *   accounts — список счетов;
 *   portfolio [-a id] — портфель: позиции, стоимость, P/L;
 *   quote <ticker> — последняя цена по точному тикеру;
 *   search <query> — поиск инструментов по названию/тикеру/ISIN;
 *   operations [-a id] [-d days] — история исполненных операций;
 *   bond <query> — карточка облигации с расчётом YTM и дюрации;
 *   dividends <query> — дивиденды: история, объявленные, TTM-доходность;
 *   fundamentals <query> — фундаментальные показатели эмитента;
 *   forecast <query> — прогнозы аналитиков и консенсус.
 */
import type { Command } from 'commander';
import { DEFAULT_OPERATIONS_DAYS } from '../config/config.js';
import { fetchAccounts, renderAccounts } from '../commands/accounts.js';
import { fetchBond, renderBond } from '../commands/bond.js';
import { fetchDividends, renderDividends } from '../commands/dividends.js';
import { fetchForecast, renderForecast } from '../commands/forecast.js';
import { fetchFundamentals, renderFundamentals } from '../commands/fundamentals.js';
import { fetchOperations, renderOperations } from '../commands/operations.js';
import { fetchPortfolio, renderPortfolio } from '../commands/portfolio.js';
import { getQuotes, renderQuotes } from '../commands/quote.js';
import { renderSearchResults, searchInstruments } from '../commands/search.js';
import { parsePositiveInt, runCommand } from './runtime.js';

export function registerCoreCommands(program: Command): void {
  program
    .command('accounts')
    .description('список счетов')
    .action(async (_opts: unknown, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const views = await fetchAccounts(client);
        return json ? views : renderAccounts(views);
      }),
    );

  program
    .command('portfolio')
    .description('портфель: позиции, стоимость, P/L')
    .option('-a, --account <id>', 'идентификатор счёта (см. tinvest accounts)')
    .action(async (opts: { account?: string }, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const view = await fetchPortfolio(client, opts.account);
        return json ? view : renderPortfolio(view);
      }),
    );

  program
    .command('quote')
    .description('последняя цена по точному тикеру (например, SBER)')
    .argument('<ticker>', 'тикер инструмента')
    .action(async (ticker: string, _opts: unknown, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const views = await getQuotes(client, ticker);
        return json ? views : renderQuotes(views);
      }),
    );

  program
    .command('search')
    .description('поиск инструментов по названию, тикеру или ISIN')
    .argument('<query>', 'поисковый запрос')
    .action(async (query: string, _opts: unknown, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const views = await searchInstruments(client, query);
        return json ? views : renderSearchResults(views);
      }),
    );

  program
    .command('operations')
    .description('история исполненных операций по счёту')
    .option('-a, --account <id>', 'идентификатор счёта (см. tinvest accounts)')
    .option('-d, --days <n>', 'период в днях от текущего момента', String(DEFAULT_OPERATIONS_DAYS))
    .action(async (opts: { account?: string; days: string }, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const result = await fetchOperations(client, {
          explicitAccountId: opts.account,
          days: parsePositiveInt(opts.days, '--days'),
          now: new Date(),
        });
        return json ? result : renderOperations(result);
      }),
    );

  program
    .command('bond')
    .description('карточка облигации: купоны, оферта, НКД, доходность к погашению, дюрация')
    .argument('<query>', 'тикер или ISIN облигации (например, RU000A10BPZ1)')
    .action(async (query: string, _opts: unknown, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const view = await fetchBond(client, query, new Date());
        return json ? view : renderBond(view);
      }),
    );

  program
    .command('dividends')
    .description('дивиденды: история выплат, объявленные будущие, TTM-доходность')
    .argument('<query>', 'тикер или ISIN бумаги (например, SBER)')
    .action(async (query: string, _opts: unknown, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const view = await fetchDividends(client, query, new Date());
        return json ? view : renderDividends(view);
      }),
    );

  program
    .command('fundamentals')
    .description('фундаментальные показатели эмитента: P/E, ROE, долг, дивиденды, рост')
    .argument('<query>', 'тикер или ISIN акции (например, SBER)')
    .action(async (query: string, _opts: unknown, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const view = await fetchFundamentals(client, query);
        return json ? view : renderFundamentals(view);
      }),
    );

  program
    .command('forecast')
    .description('прогнозы аналитиков: консенсус, целевые цены, рекомендации')
    .argument('<query>', 'тикер или ISIN акции (например, SBER)')
    .action(async (query: string, _opts: unknown, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const view = await fetchForecast(client, query);
        return json ? view : renderForecast(view);
      }),
    );
}
