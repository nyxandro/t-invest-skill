/**
 * Регистрация аналитических команд портфеля.
 *
 * Экспорты:
 * - registerAnalyticsCommands(program) — добавляет команды:
 *   performance [-a id] — реальная доходность счёта: XIRR с открытия,
 *   вложено/выведено/чистый результат, дивиденды/купоны/комиссии/налоги;
 *   allocation [-a id] — структура портфеля: классы активов, секторы,
 *   валюты, страны, концентрация позиций;
 *   cash [-a id] — свободные деньги: доступный остаток и блокировки;
 *   income [-a id] — календарь пассивного дохода (купоны + дивиденды).
 */
import type { Command } from 'commander';
import { fetchAllocation, renderAllocation, renderAllocationChart } from '../commands/allocation.js';
import { fetchCash, renderCash } from '../commands/cash.js';
import { fetchIncome, renderIncome, renderIncomeChart } from '../commands/income.js';
import { fetchPerformance, renderPerformance } from '../commands/performance.js';
import { runCommand, withChart } from './runtime.js';

export function registerAnalyticsCommands(program: Command): void {
  program
    .command('performance')
    .description('реальная доходность счёта: XIRR, вложено/выведено, дивиденды, комиссии')
    .option('-a, --account <id>', 'идентификатор счёта (см. tinvest accounts)')
    .action(async (opts: { account?: string }, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const view = await fetchPerformance(client, {
          explicitAccountId: opts.account,
          now: new Date(),
        });
        return json ? view : renderPerformance(view);
      }),
    );

  program
    .command('allocation')
    .description('структура портфеля: классы активов, секторы, валюты, страны, концентрация')
    .option('-a, --account <id>', 'идентификатор счёта (см. tinvest accounts)')
    .option('--chart', 'добавить ASCII-график структуры (бары по секторам и классам активов)')
    .action(async (opts: { account?: string; chart?: boolean }, cmd: Command) =>
      runCommand(cmd, async (client, json, mode) => {
        const view = await fetchAllocation(client, {
          explicitAccountId: opts.account,
          mode,
          now: new Date(),
        });
        return withChart(json, view, renderAllocation(view), opts.chart ? renderAllocationChart(view) : undefined);
      }),
    );

  program
    .command('cash')
    .description('свободные деньги на счёте: доступный остаток и блокировки')
    .option('-a, --account <id>', 'идентификатор счёта (см. tinvest accounts)')
    .action(async (opts: { account?: string }, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const view = await fetchCash(client, opts.account);
        return json ? view : renderCash(view);
      }),
    );

  program
    .command('income')
    .description('календарь пассивного дохода: будущие купоны и объявленные дивиденды портфеля')
    .option('-a, --account <id>', 'идентификатор счёта (см. tinvest accounts)')
    .option('--chart', 'добавить ASCII-график дохода по месяцам (бары)')
    .action(async (opts: { account?: string; chart?: boolean }, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const view = await fetchIncome(client, { explicitAccountId: opts.account, now: new Date() });
        return withChart(json, view, renderIncome(view), opts.chart ? renderIncomeChart(view) : undefined);
      }),
    );
}
