/**
 * Регистрация торговых команд (песочница и режим full; в readonly доступно
 * только чтение заявок — мутации блокируются кодом до обращения к API).
 *
 * Экспорты:
 * - registerTradingCommands(program) — добавляет команды:
 *   order preview <query> -q <lots> [--price P] [--direction buy|sell];
 *   order buy/sell <query> -q <lots> [--price P] [--confirm] [--order-id id];
 *   order list / order status <id> / order cancel <id> [--confirm];
 *   order replace <id> -q <lots> --price P [--confirm];
 *   stop-order set <query> -q <lots> --type <kind> --stop-price S [...];
 *   stop-order list / stop-order cancel <id> [--confirm].
 *
 * В режиме full каждая мутация требует --confirm — флаг ставится только
 * после явного подтверждения пользователя (правило скилла).
 */
import type { Command } from 'commander';
import { AppError } from '../api/errors.js';
import {
  cancelOrder,
  listOrders,
  orderStatus,
  placeOrder,
  previewOrder,
  replaceOrder,
  type TradeDirection,
} from '../commands/trading/orders.js';
import {
  renderOrderPreview,
  renderOrderState,
  renderOrders,
  renderPlacedOrder,
} from '../commands/trading/orders-render.js';
import {
  cancelStopOrder,
  listStopOrders,
  placeStopOrder,
  renderPlacedStopOrder,
  renderStopOrders,
  type StopOrderKind,
} from '../commands/trading/stop-orders.js';
import { parsePositiveInt, parsePositiveNumber, runCommand } from './runtime.js';

function parseDirection(raw: string): TradeDirection {
  if (raw === 'buy' || raw === 'sell') {
    return raw;
  }
  throw new AppError({
    code: 'APP_CLI_INVALID_ARGUMENT',
    userMessage: `Параметр --direction принимает значения buy | sell; получено «${raw}».`,
  });
}

function parseStopKind(raw: string): StopOrderKind {
  if (raw === 'take-profit' || raw === 'stop-loss' || raw === 'stop-limit') {
    return raw;
  }
  throw new AppError({
    code: 'APP_CLI_INVALID_ARGUMENT',
    userMessage: `Параметр --type принимает значения take-profit | stop-loss | stop-limit; получено «${raw}».`,
  });
}

// Общая регистрация buy/sell — отличается только направлением.
function registerPlaceCommand(order: Command, direction: TradeDirection): void {
  order
    .command(direction)
    .description(`${direction === 'buy' ? 'купить' : 'продать'}: рыночная (без --price) или лимитная заявка`)
    .argument('<query>', 'тикер или ISIN инструмента')
    .requiredOption('-q, --lots <n>', 'количество ЛОТОВ (см. размер лота в order preview)')
    .option(
      '--price <price>',
      'лимитная цена (без неё — рыночная заявка); для облигаций и фьючерсов — в пунктах (% номинала)',
    )
    .option('-a, --account <id>', 'идентификатор счёта')
    .option('--confirm', 'подтверждение сделки реальными деньгами (обязателен в режиме full)')
    .option('--order-id <id>', 'свой ключ идемпотентности (повтор той же заявки не продублирует её)')
    .action(
      async (
        query: string,
        opts: { lots: string; price?: string; account?: string; confirm?: boolean; orderId?: string },
        cmd: Command,
      ) =>
        runCommand(cmd, async (client, json, mode, tradingGate) => {
          const view = await placeOrder(client, {
            mode,
            explicitAccountId: opts.account,
            query,
            lots: parsePositiveInt(opts.lots, '--lots'),
            direction,
            limitPrice: opts.price !== undefined ? parsePositiveNumber(opts.price, '--price') : null,
            orderId: opts.orderId,
            confirm: Boolean(opts.confirm),
            tradingGate,
          });
          return json ? view : renderPlacedOrder(view);
        }),
    );
}

export function registerTradingCommands(program: Command): void {
  const order = program
    .command('order')
    .description('торговые заявки (песочница/боевой; в full мутации требуют --confirm)');

  order
    .command('preview')
    .description('предпросмотр: оценка суммы, комиссия, доступные лоты (без выставления)')
    .argument('<query>', 'тикер или ISIN инструмента')
    .requiredOption('-q, --lots <n>', 'количество лотов')
    .option(
      '--price <price>',
      'лимитная цена (без неё — оценка по последней рыночной); облигации/фьючерсы — в пунктах (% номинала)',
    )
    .option('--direction <dir>', 'направление: buy | sell', 'buy')
    .option('-a, --account <id>', 'идентификатор счёта')
    .action(
      async (
        query: string,
        opts: { lots: string; price?: string; direction: string; account?: string },
        cmd: Command,
      ) =>
        runCommand(cmd, async (client, json, mode) => {
          const view = await previewOrder(client, {
            mode,
            explicitAccountId: opts.account,
            query,
            lots: parsePositiveInt(opts.lots, '--lots'),
            direction: parseDirection(opts.direction),
            limitPrice: opts.price !== undefined ? parsePositiveNumber(opts.price, '--price') : null,
          });
          return json ? view : renderOrderPreview(view);
        }),
    );

  registerPlaceCommand(order, 'buy');
  registerPlaceCommand(order, 'sell');

  order
    .command('list')
    .description('активные заявки по счёту')
    .option('-a, --account <id>', 'идентификатор счёта')
    .action(async (opts: { account?: string }, cmd: Command) =>
      runCommand(cmd, async (client, json, mode) => {
        const views = await listOrders(client, { mode, explicitAccountId: opts.account });
        return json ? views : renderOrders(views);
      }),
    );

  order
    .command('status')
    .description('статус заявки по номеру')
    .argument('<orderId>', 'номер заявки')
    .option('-a, --account <id>', 'идентификатор счёта')
    .action(async (orderId: string, opts: { account?: string }, cmd: Command) =>
      runCommand(cmd, async (client, json, mode) => {
        const view = await orderStatus(client, { mode, explicitAccountId: opts.account, orderId });
        return json ? view : renderOrderState(view);
      }),
    );

  order
    .command('cancel')
    .description('отменить заявку')
    .argument('<orderId>', 'номер заявки')
    .option('-a, --account <id>', 'идентификатор счёта')
    .option('--confirm', 'подтверждение (обязателен в режиме full)')
    .action(async (orderId: string, opts: { account?: string; confirm?: boolean }, cmd: Command) =>
      runCommand(cmd, async (client, json, mode, tradingGate) => {
        const result = await cancelOrder(client, {
          mode,
          explicitAccountId: opts.account,
          orderId,
          confirm: Boolean(opts.confirm),
          tradingGate,
        });
        return json ? result : `Заявка ${orderId} отменена${result.cancelledAt ? ` (${result.cancelledAt})` : ''}.`;
      }),
    );

  order
    .command('replace')
    .description('заменить лимитную заявку: новые количество и цена')
    .argument('<orderId>', 'номер заменяемой заявки')
    .requiredOption('-q, --lots <n>', 'новое количество лотов')
    .requiredOption('--price <price>', 'новая лимитная цена (облигации/фьючерсы — в пунктах, % номинала)')
    .option('-a, --account <id>', 'идентификатор счёта')
    .option('--confirm', 'подтверждение (обязателен в режиме full)')
    .option('--order-id <id>', 'свой ключ идемпотентности замены (для безопасного повтора)')
    .action(
      async (
        orderId: string,
        opts: { lots: string; price: string; account?: string; confirm?: boolean; orderId?: string },
        cmd: Command,
      ) =>
        runCommand(cmd, async (client, json, mode, tradingGate) => {
          const view = await replaceOrder(client, {
            mode,
            explicitAccountId: opts.account,
            orderId,
            lots: parsePositiveInt(opts.lots, '--lots'),
            price: parsePositiveNumber(opts.price, '--price'),
            newOrderId: opts.orderId,
            confirm: Boolean(opts.confirm),
            tradingGate,
          });
          return json ? view : renderPlacedOrder(view);
        }),
    );

  const stopOrder = program
    .command('stop-order')
    .description('стоп-заявки: тейк-профит, стоп-лосс, стоп-лимит');

  stopOrder
    .command('set')
    .description('выставить стоп-заявку (бессрочную, до отмены)')
    .argument('<query>', 'тикер или ISIN инструмента')
    .requiredOption('-q, --lots <n>', 'количество лотов')
    .requiredOption('--type <kind>', 'тип: take-profit | stop-loss | stop-limit')
    .requiredOption('--stop-price <price>', 'цена активации (облигации/фьючерсы — в пунктах, % номинала)')
    .option(
      '--price <price>',
      'лимитная цена после активации (обязательна для stop-limit; облигации/фьючерсы — в пунктах)',
    )
    .option('--direction <dir>', 'направление: buy | sell', 'sell')
    .option('-a, --account <id>', 'идентификатор счёта')
    .option('--confirm', 'подтверждение (обязателен в режиме full)')
    .option('--order-id <id>', 'свой ключ идемпотентности (для безопасного повтора)')
    .action(
      async (
        query: string,
        opts: {
          lots: string;
          type: string;
          stopPrice: string;
          price?: string;
          direction: string;
          account?: string;
          confirm?: boolean;
          orderId?: string;
        },
        cmd: Command,
      ) =>
        runCommand(cmd, async (client, json, mode, tradingGate) => {
          const view = await placeStopOrder(client, {
            mode,
            explicitAccountId: opts.account,
            query,
            lots: parsePositiveInt(opts.lots, '--lots'),
            kind: parseStopKind(opts.type),
            direction: parseDirection(opts.direction),
            stopPrice: parsePositiveNumber(opts.stopPrice, '--stop-price'),
            limitPrice: opts.price !== undefined ? parsePositiveNumber(opts.price, '--price') : null,
            orderId: opts.orderId,
            confirm: Boolean(opts.confirm),
            tradingGate,
          });
          return json ? view : renderPlacedStopOrder(view);
        }),
    );

  stopOrder
    .command('list')
    .description('активные стоп-заявки по счёту')
    .option('-a, --account <id>', 'идентификатор счёта')
    .action(async (opts: { account?: string }, cmd: Command) =>
      runCommand(cmd, async (client, json, mode) => {
        const views = await listStopOrders(client, { mode, explicitAccountId: opts.account });
        return json ? views : renderStopOrders(views);
      }),
    );

  stopOrder
    .command('cancel')
    .description('отменить стоп-заявку')
    .argument('<stopOrderId>', 'номер стоп-заявки')
    .option('-a, --account <id>', 'идентификатор счёта')
    .option('--confirm', 'подтверждение (обязателен в режиме full)')
    .action(async (stopOrderId: string, opts: { account?: string; confirm?: boolean }, cmd: Command) =>
      runCommand(cmd, async (client, json, mode, tradingGate) => {
        const result = await cancelStopOrder(client, {
          mode,
          explicitAccountId: opts.account,
          stopOrderId,
          confirm: Boolean(opts.confirm),
          tradingGate,
        });
        return json
          ? result
          : `Стоп-заявка ${stopOrderId} отменена${result.cancelledAt ? ` (${result.cancelledAt})` : ''}.`;
      }),
    );
}
