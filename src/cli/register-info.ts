/**
 * Регистрация команд информационного слоя.
 *
 * Экспорты:
 * - registerInfoCommands(program) — добавляет команды:
 *   news [query] [-n limit] — лента новостей рынка или подборка по бумаге;
 *   insiders <query> [-n limit] — сделки инсайдеров по бумаге;
 *   reports <query> — календарь отчётностей эмитента;
 *   signals [--ticker T] [--strategies] — сигналы аналитических стратегий;
 *   favorites — вотчлист из приложения Т-Инвестиций с ценами.
 */
import type { Command } from 'commander';
import { fetchFavorites, renderFavorites } from '../commands/favorites.js';
import { fetchInsiders, renderInsiders } from '../commands/insiders.js';
import { fetchNews, renderNews } from '../commands/news.js';
import { fetchReports, renderReports } from '../commands/reports.js';
import {
  fetchSignals,
  fetchStrategies,
  renderSignals,
  renderStrategies,
} from '../commands/signals.js';
import { INSIDERS_DEFAULT_LIMIT, NEWS_DEFAULT_LIMIT } from '../config/config.js';
import { parsePositiveInt, runCommand } from './runtime.js';

export function registerInfoCommands(program: Command): void {
  program
    .command('news')
    .description('новости рынка (без аргумента) или по конкретной бумаге')
    .argument('[query]', 'тикер или ISIN бумаги (без него — общая лента)')
    .option('-n, --limit <n>', 'сколько новостей показать', String(NEWS_DEFAULT_LIMIT))
    .action(async (query: string | undefined, opts: { limit: string }, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const view = await fetchNews(client, {
          query,
          limit: parsePositiveInt(opts.limit, '--limit'),
        });
        return json ? view : renderNews(view);
      }),
    );

  program
    .command('insiders')
    .description('сделки инсайдеров по бумаге (раскрытие эмитента)')
    .argument('<query>', 'тикер или ISIN бумаги')
    .option('-n, --limit <n>', 'сколько сделок показать', String(INSIDERS_DEFAULT_LIMIT))
    .action(async (query: string, opts: { limit: string }, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const view = await fetchInsiders(client, query, parsePositiveInt(opts.limit, '--limit'));
        return json ? view : renderInsiders(view);
      }),
    );

  program
    .command('reports')
    .description('календарь отчётностей эмитента: прошедшие и ожидаемые публикации')
    .argument('<query>', 'тикер или ISIN бумаги')
    .action(async (query: string, _opts: unknown, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const view = await fetchReports(client, query, new Date());
        return json ? view : renderReports(view);
      }),
    );

  program
    .command('signals')
    .description('активные сигналы аналитических стратегий (SignalService)')
    .option('--ticker <ticker>', 'только по конкретной бумаге')
    .option('--strategy <id>', 'только по конкретной стратегии')
    .option('--strategies', 'показать список стратегий вместо сигналов')
    .action(
      async (
        opts: { ticker?: string; strategy?: string; strategies?: boolean },
        cmd: Command,
      ) =>
        runCommand(cmd, async (client, json, mode) => {
          if (opts.strategies) {
            const strategies = await fetchStrategies(client);
            return json ? strategies : renderStrategies(strategies);
          }
          const views = await fetchSignals(client, {
            mode,
            now: new Date(),
            ticker: opts.ticker,
            strategyId: opts.strategy,
          });
          return json ? views : renderSignals(views);
        }),
    );

  program
    .command('favorites')
    .description('вотчлист из приложения Т-Инвестиций с текущими ценами')
    .action(async (_opts: unknown, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const views = await fetchFavorites(client);
        return json ? views : renderFavorites(views);
      }),
    );
}
