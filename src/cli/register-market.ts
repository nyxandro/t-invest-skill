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
 *   tech <query> — RSI/SMA/MACD с нейтральными наблюдениями;
 *   schedule [exchange] [-d days] — расписание торгов площадок (сессии в МСК);
 *   last-trades <query> [--hours n] — лента обезличенных сделок рынка.
 */
import type { Command } from 'commander';
import { fetchHistory, renderHistory, renderHistoryChart } from '../commands/history.js';
import { fetchInstrumentCard, renderInstrumentCard } from '../commands/instrument.js';
import { fetchLastTrades, renderLastTrades } from '../commands/last-trades.js';
import { fetchOrderBook, renderOrderBook } from '../commands/orderbook.js';
import { fetchSchedule, renderSchedule } from '../commands/schedule.js';
import { fetchTech, renderTech } from '../commands/tech.js';
import {
  DEFAULT_HISTORY_DAYS,
  LAST_TRADES_DEFAULT_HOURS,
  ORDERBOOK_DEPTH_DEFAULT,
  ORDERBOOK_DEPTH_MAX,
  SCHEDULE_DEFAULT_DAYS,
} from '../config/config.js';
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

  program
    .command('schedule')
    .description('расписание торгов площадок: когда открыты сессии (время в МСК)')
    .argument('[exchange]', 'площадка (например, MOEX); без неё — все доступные')
    .option('-d, --days <n>', 'период вперёд в днях', String(SCHEDULE_DEFAULT_DAYS))
    .action(async (exchange: string | undefined, opts: { days: string }, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const view = await fetchSchedule(client, {
          exchange,
          days: parsePositiveInt(opts.days, '--days'),
          now: new Date(),
        });
        return json ? view : renderSchedule(view);
      }),
    );

  program
    .command('last-trades')
    .description('лента обезличенных сделок рынка по бумаге (оценка активности/ликвидности)')
    .argument('<query>', 'тикер или ISIN инструмента')
    .option('--hours <n>', 'период назад в часах', String(LAST_TRADES_DEFAULT_HOURS))
    .action(async (query: string, opts: { hours: string }, cmd: Command) =>
      runCommand(cmd, async (client, json) => {
        const view = await fetchLastTrades(client, {
          query,
          hours: parsePositiveInt(opts.hours, '--hours'),
          now: new Date(),
        });
        return json ? view : renderLastTrades(view);
      }),
    );
}
