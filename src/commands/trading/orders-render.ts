/**
 * Текстовые рендеры торговых заявок для CLI (человекочитаемый вывод, не JSON).
 * Вынесены из orders.ts: логика заявок и их представление разделены, чтобы
 * файл заявок держался в лимите строк, а рендеры переиспользовались командами.
 *
 * Цена облигаций/фьючерсов показывается в пунктах с меткой «пт» и (где известен
 * номинал) рублёвым эквивалентом — чтобы пользователь не принял пункты за рубли.
 *
 * Экспорты:
 * - renderPlacedOrder(view) — итог выставленной/заменённой заявки;
 * - renderOrderPreview(view) — предпросмотр (оценка суммы, комиссия, лоты);
 * - renderOrders(views) — таблица активных заявок;
 * - renderOrderState(view) — карточка состояния одной заявки.
 */
import { renderTable } from '../../format/table.js';
import { DASH } from '../../format/values.js';
import { formatInstrumentPrice, formatMoneyAmount } from '../../format/units.js';
import { directionLabel, directionPhrase, type TradeDirection } from '../../format/direction.js';
import type { OrderPreviewView, OrderStateView, PlacedOrderView } from './orders.js';

// Заголовок заявки: направление может быть неизвестно (null) — тогда фразу о
// направлении опускаем, а не подставляем «покупку».
function placedHeaderDirection(direction: TradeDirection | null): string {
  return direction ? `${directionPhrase(direction)} ` : '';
}

export function renderPlacedOrder(view: PlacedOrderView): string {
  const lines = [
    `Заявка ${placedHeaderDirection(view.direction)}${view.ticker} (${view.orderType === 'limit' ? 'лимитная' : 'рыночная'}): ${view.statusText ?? DASH}`,
    `Номер: ${view.orderId ?? DASH} | ключ идемпотентности: ${view.clientOrderId} | лотов: ${view.lotsExecuted ?? 0}/${view.lotsRequested ?? DASH}`,
    // Сумма помечается единицей из ответа API: у ещё не исполненной заявки по
    // облигации приходит в пунктах (currency "pt."), у исполненной — в рублях.
    `Сумма: ${view.totalAmount !== null ? formatMoneyAmount(view.totalAmount, view.currency) : DASH}` +
      (view.commission !== null ? ` | комиссия: ${formatMoneyAmount(view.commission, view.currency)}` : ''),
  ];
  if (view.message) {
    lines.push(`Сообщение брокера: ${view.message}`);
  }
  return lines.join('\n');
}

export function renderOrderPreview(view: OrderPreviewView): string {
  const priceText =
    view.priceUsed !== null
      ? formatInstrumentPrice(view.priceUsed, {
          unit: view.priceUnit,
          nominalRub: view.nominalRub,
          currency: view.currency,
        })
      : DASH;
  const lines = [
    `Предпросмотр: ${directionLabel(view.direction)} ${view.ticker} (${view.name}), лотов: ${view.lots}` +
      (view.lotSize !== null ? ` (в лоте ${view.lotSize} шт.)` : ''),
    `Цена для оценки: ${priceText} (${view.priceSource === 'limit' ? 'лимитная' : 'последняя рыночная'})`,
    `Оценка суммы: ${view.estimatedAmount !== null ? formatMoneyAmount(view.estimatedAmount, view.currency) : DASH}` +
      (view.commission !== null ? ` | комиссия: ${formatMoneyAmount(view.commission, view.currency)}` : ''),
    `Доступно: покупка до ${view.maxBuyLots ?? DASH} лотов | продажа до ${view.maxSellLots ?? DASH} лотов` +
      (view.availableMoney !== null ? ` | свободно ${formatMoneyAmount(view.availableMoney, view.currency)}` : ''),
  ];
  // Ловушка API: GetOrderPrice/GetMaxLots не знают priceType и для облигаций/
  // фьючерсов считают сумму по цене-в-пунктах (без номинала) — оценка занижена.
  // Предупреждаем и отсылаем к факту, а цену в ₽/шт пользователь видит выше.
  if (view.priceUnit === 'point') {
    lines.push(
      'Примечание: оценка суммы от API по облигациям/фьючерсам занижена (считается без номинала) — ' +
        'ориентируйтесь на цену выше и проверяйте фактическое списание через portfolio/operations.',
    );
  }
  return lines.join('\n');
}

export function renderOrders(views: OrderStateView[]): string {
  if (views.length === 0) {
    return 'Активных заявок нет.';
  }
  return renderTable(
    ['Номер', 'Тикер', 'Напр.', 'Статус', 'Лоты', 'Цена', 'Сумма'],
    views.map((v) => [
      v.orderId ?? DASH,
      v.ticker ?? DASH,
      directionLabel(v.direction),
      v.statusText ?? DASH,
      `${v.lotsExecuted ?? 0}/${v.lotsRequested ?? DASH}`,
      // В таблице цена помечается единицей, но без ₽-эквивалента (nominalRub не
      // тянем на список) — компактно: «100.50 пт» для облигации, «300.50 ₽» для акции.
      v.initialPrice !== null
        ? formatInstrumentPrice(v.initialPrice, { unit: v.priceUnit, nominalRub: null, currency: v.currency })
        : DASH,
      v.totalAmount !== null ? formatMoneyAmount(v.totalAmount, v.currency) : DASH,
    ]),
  );
}

export function renderOrderState(view: OrderStateView): string {
  const priceText =
    view.initialPrice !== null
      ? formatInstrumentPrice(view.initialPrice, {
          unit: view.priceUnit,
          nominalRub: view.nominalRub,
          currency: view.currency,
        })
      : DASH;
  return [
    `Заявка ${view.orderId ?? DASH}: ${view.statusText ?? DASH}`,
    `${view.ticker ?? DASH} | ${directionLabel(view.direction)} | лотов ${view.lotsExecuted ?? 0}/${view.lotsRequested ?? DASH}`,
    `Цена: ${priceText} | сумма: ${view.totalAmount !== null ? formatMoneyAmount(view.totalAmount, view.currency) : DASH}`,
  ].join('\n');
}
