#!/usr/bin/env node
/**
 * Точка входа CLI «tinvest» — консоль для Т-Инвестиций (T-Invest API).
 *
 * Режимы (флаг -m/--mode, токен на каждый режим свой):
 * - sandbox — песочница (T_INVEST_TOKEN_SANDBOX, отдельный контур API);
 * - readonly — боевой счёт, токен «только чтение» (T_INVEST_TOKEN_READONLY);
 * - full — боевой счёт, полноправный токен (T_INVEST_TOKEN_FULL).
 * Без --mode режим определяется по единственному заполненному токену.
 *
 * Команды зарегистрированы доменными модулями (src/cli/register-*.ts):
 * - register-core — счета, портфель, котировки, поиск, операции, карточки
 *   (bond/dividends/fundamentals/forecast);
 * - register-session — session start/status/end, sandbox init;
 * - остальные домены (аналитика, рынок, инфослой, скринеры, торговля)
 *   подключаются по мере реализации.
 *
 * Каркас исполнения (env, границы ошибок, парсеры) — src/cli/runtime.ts.
 * Глобальный флаг --json — машиночитаемый вывод (для скилла Claude Code).
 */
import { Command } from 'commander';
import { registerAnalyticsCommands } from './cli/register-analytics.js';
import { registerCoreCommands } from './cli/register-core.js';
import { registerInfoCommands } from './cli/register-info.js';
import { registerMarketCommands } from './cli/register-market.js';
import { registerScreenCommands } from './cli/register-screen.js';
import { registerSessionCommands } from './cli/register-session.js';
import { registerTradingCommands } from './cli/register-trading.js';
import { bootstrapEnv, printErrorAndExit } from './cli/runtime.js';

bootstrapEnv();

const program = new Command();
program
  .name('tinvest')
  .description('CLI для Т-Инвестиций (T-Invest API): портфель, котировки, поиск, операции')
  .version('0.1.0')
  .option('--json', 'вывод в формате JSON (для интеграций и Claude)')
  .option(
    '-m, --mode <mode>',
    'режим: sandbox | readonly | full (по умолчанию — по единственному заполненному токену)',
  );

registerCoreCommands(program);
registerAnalyticsCommands(program);
registerMarketCommands(program);
registerInfoCommands(program);
registerScreenCommands(program);
registerTradingCommands(program);
registerSessionCommands(program);

program.parseAsync(process.argv).catch(printErrorAndExit);
