/**
 * Регистрация рыночных команд: история цены, карточка инструмента,
 * стакан и технические индикаторы.
 *
 * Экспорты:
 * - registerMarketCommands(program) — добавляет команды:
 *   history <query> [-d days] [--vs ticker] — динамика цены за период,
 *   волатильность, сравнение с бенчмарком (индексы IMOEX/RTSI поддержаны);
 *   instrument <query> — универсальная карточка любого актива;
 *   orderbook <query> [--depth n] — биржевой стакан: спред, ликвидность;
 *   tech <query> — RSI/SMA/MACD с нейтральными наблюдениями.
 */
import type { Command } from 'commander';
import { fetchHistory, renderHistory, renderHistoryChart } from '../commands/history.js';
import { fetchInstrumentCard, renderInstrumentCard } from '../commands/instrument.js';
import { fetchOrderBook, renderOrderBook } from '../commands/orderbook.js';
import { fetchTech, renderTech } from '../commands/tech.js';
import { DEFAULT_HISTORY_DAYS, ORDERBOOK_DEPTH_DEFAULT, ORDERBOOK_DEPTH_MAX } from '../config/config.js';
import { parsePositiveInt, runCommand, withChart } from './runtime.js';

export function registerMarketCommands(program: Command): void {
  program
    .command('history')
    .description('динамика цены за период: изменение, диапазон, волатильность, бенчмарк')
    .argument('<query>', 'тикер или ISIN (индексы тоже: IMOEX, RTSI)')
    .option('-d, --days <n>', 'период в днях', String(DEFAULT_HISTORY_DAYS))
    .option('--vs <ticker>', 'сравнить с бенчмарком (например, IMOEX)')
    .option('--chart', 'добавить брайль-линию цены закрытия за период')
    .action(async (query: string, opts: { days: string; vs?: string; chart?: boolean }, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const view = await fetchHistory(client, {
          query,
          days: parsePositiveInt(opts.days, '--days'),
          vs: opts.vs,
          now: new Date(),
        });
        // В человекочитаемом выводе свечи опускаем — это массив для анализа.
        return withChart(json, view, renderHistory(view), opts.chart ? renderHistoryChart(view) : undefined);
      }),
    );

  program
    .command('instrument')
    .description('универсальная карточка актива: тип, лот, цена, статус торгов, ГО фьючерса')
    .argument('<query>', 'тикер или ISIN инструмента')
    .action(async (query: string, _opts: unknown, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const view = await fetchInstrumentCard(client, query);
        return json ? view : renderInstrumentCard(view);
      }),
    );

  program
    .command('orderbook')
    .description('биржевой стакан: лучшие цены, спред, объёмы (оценка ликвидности)')
    .argument('<query>', 'тикер или ISIN инструмента')
    .option('--depth <n>', 'глубина стакана', String(ORDERBOOK_DEPTH_DEFAULT))
    .action(async (query: string, opts: { depth: string }, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const depth = parsePositiveInt(opts.depth, '--depth', ORDERBOOK_DEPTH_MAX);
        const view = await fetchOrderBook(client, query, depth);
        return json ? view : renderOrderBook(view);
      }),
    );

  program
    .command('tech')
    .description('технические индикаторы: RSI, SMA(20/50), MACD (дневной интервал)')
    .argument('<query>', 'тикер или ISIN инструмента')
    .action(async (query: string, _opts: unknown, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const view = await fetchTech(client, query, new Date());
        return json ? view : renderTech(view);
      }),
    );
}
