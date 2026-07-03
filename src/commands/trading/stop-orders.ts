/**
 * Стоп-заявки: тейк-профит, стоп-лосс, стоп-лимит (песочница и full;
 * предохранители — trading/paths.ts).
 *
 * Экспорты:
 * - StopOrderKind — человекочитаемые типы стоп-заявок CLI;
 * - placeStopOrder(api, params) — выставить стоп-заявку;
 * - listStopOrders(api, params) — активные стоп-заявки;
 * - cancelStopOrder(api, params) — отменить стоп-заявку;
 * - renderPlacedStopOrder / renderStopOrders — вывод.
 */
import { randomUUID } from 'node:crypto';
import { AppError } from '../../api/errors.js';
import { formatAmount, moneyToNumberOrNull, numberToQuotation } from '../../api/money.js';
import type {
  CancelStopOrderResponse,
  GetStopOrdersResponse,
  PostStopOrderRequest,
  PostStopOrderResponse,
  StopOrderInfo,
  StopOrderType,
} from '../../api/types-trading.js';
import { BATCH_CONCURRENCY, BATCH_MIN_INTERVAL_MS, type TInvestMode, type TradingGate } from '../../config/config.js';
import { renderTable } from '../../format/table.js';
import { formatMoscowDate } from '../../format/datetime.js';
import { DASH } from '../../format/values.js';
import { directionFromApi, directionLabel, stopDirectionToApi } from '../../format/direction.js';
import { mapWithConcurrency } from '../../util/concurrency.js';
import { resolveAccountId } from '../resolve-account.js';
import { resolveLabelByFigi } from '../resolve-instrument.js';
import { assertMutationAllowed, tradingPathsForMode } from './paths.js';
import { resolveTradeInstrument, type TradeDirection, type TradingApi } from './orders.js';

export type StopOrderKind = 'take-profit' | 'stop-loss' | 'stop-limit';

const STOP_TYPE_BY_KIND: Record<StopOrderKind, StopOrderType> = {
  'take-profit': 'STOP_ORDER_TYPE_TAKE_PROFIT',
  'stop-loss': 'STOP_ORDER_TYPE_STOP_LOSS',
  'stop-limit': 'STOP_ORDER_TYPE_STOP_LIMIT',
};

export interface PlacedStopOrderView {
  stopOrderId: string | null;
  ticker: string;
  kind: StopOrderKind;
  direction: TradeDirection;
  lots: number;
  stopPrice: number;
  limitPrice: number | null;
}

export async function placeStopOrder(
  api: TradingApi,
  params: {
    mode: TInvestMode;
    explicitAccountId?: string;
    query: string;
    lots: number;
    kind: StopOrderKind;
    direction: TradeDirection;
    stopPrice: number;
    limitPrice: number | null;
    orderId?: string; // свой ключ идемпотентности для безопасного повтора
    confirm: boolean;
    tradingGate: TradingGate;
  },
): Promise<PlacedStopOrderView> {
  assertMutationAllowed(params.mode, params.confirm, params.tradingGate);
  // Стоп-лимит без лимитной цены не имеет смысла — явная ошибка до API.
  if (params.kind === 'stop-limit' && params.limitPrice === null) {
    throw new AppError({
      code: 'APP_CLI_INVALID_ARGUMENT',
      userMessage: 'Для стоп-лимита укажите лимитную цену: --price <цена>.',
    });
  }
  const paths = tradingPathsForMode(params.mode);
  // Резолвы счёта и инструмента независимы — параллелим.
  const [accountId, instrument] = await Promise.all([
    resolveAccountId(api, params.explicitAccountId),
    resolveTradeInstrument(api, params.query),
  ]);

  const clientOrderId = params.orderId ?? randomUUID();
  const request: PostStopOrderRequest = {
    accountId,
    instrumentId: instrument.uid,
    quantity: String(params.lots),
    direction: stopDirectionToApi(params.direction),
    stopOrderType: STOP_TYPE_BY_KIND[params.kind],
    expirationType: 'STOP_ORDER_EXPIRATION_TYPE_GOOD_TILL_CANCEL',
    stopPrice: numberToQuotation(params.stopPrice),
    ...(params.limitPrice !== null ? { price: numberToQuotation(params.limitPrice) } : {}),
    orderId: clientOrderId,
  };
  // Ключ идемпотентности в stderr до отправки — для безопасного повтора (--order-id).
  console.error(
    `Ключ идемпотентности стоп-заявки: ${clientOrderId}. Для повтора: --order-id ${clientOrderId}`,
  );
  const resp = await api.call<PostStopOrderResponse>(paths.postStopOrder, request);
  return {
    stopOrderId: resp.stopOrderId ?? null,
    ticker: instrument.ticker,
    kind: params.kind,
    direction: params.direction,
    lots: params.lots,
    stopPrice: params.stopPrice,
    limitPrice: params.limitPrice,
  };
}

export interface StopOrderView {
  stopOrderId: string | null;
  ticker: string | null; // figi, если тикера нет в ответе
  direction: TradeDirection | null;
  lots: number | null;
  stopPrice: number | null;
  limitPrice: number | null;
  createDate: string | null;
  status: string | null;
}

export function toStopOrderView(info: StopOrderInfo): StopOrderView {
  // Лимитная цена: у тейк-профита/стоп-лосса её нет, приходит нулём — трактуем
  // ноль как «нет лимита» (в отличие от stopPrice, где ноль был бы данными).
  const limit = moneyToNumberOrNull(info.price);
  return {
    stopOrderId: info.stopOrderId ?? null,
    ticker: info.figi ?? info.instrumentUid ?? null,
    direction: directionFromApi(info.direction),
    lots: info.lotsRequested ? Number(info.lotsRequested) : null,
    stopPrice: moneyToNumberOrNull(info.stopPrice),
    limitPrice: limit !== null && limit !== 0 ? limit : null,
    createDate: info.createDate ?? null,
    status: info.status ?? null,
  };
}

export async function listStopOrders(
  api: TradingApi,
  params: { mode: TInvestMode; explicitAccountId?: string },
): Promise<StopOrderView[]> {
  const paths = tradingPathsForMode(params.mode);
  const accountId = await resolveAccountId(api, params.explicitAccountId);
  const resp = await api.call<GetStopOrdersResponse>(paths.getStopOrders, { accountId });
  const infos = resp.stopOrders ?? [];
  // GetStopOrders не отдаёт ticker (только figi) — резолвим бумагу по figi,
  // иначе в списке виден сырой FIGI. Троттлим батч (как в портфеле, чтобы не
  // ловить 429) и терпим сбой одной карточки: тикер — презентационное поле,
  // при неудаче остаётся figi (политика no-fallbacks её не покрывает).
  const uniqueFigis = [...new Set(infos.map((i) => i.figi).filter((f): f is string => Boolean(f)))];
  const tickerByFigi = new Map<string, string>();
  if (uniqueFigis.length > 0) {
    await mapWithConcurrency(
      uniqueFigis,
      { concurrency: BATCH_CONCURRENCY, minIntervalMs: BATCH_MIN_INTERVAL_MS },
      async (figi): Promise<null> => {
        try {
          const label = await resolveLabelByFigi(api, figi);
          if (label) {
            tickerByFigi.set(figi, label.ticker);
          }
        } catch (err) {
          console.error(
            `Предупреждение: не удалось получить тикер по FIGI ${figi}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        return null;
      },
    );
  }
  return infos.map((info) => {
    const view = toStopOrderView(info);
    const ticker = info.figi ? tickerByFigi.get(info.figi) : undefined;
    return ticker ? { ...view, ticker } : view;
  });
}

export async function cancelStopOrder(
  api: TradingApi,
  params: {
    mode: TInvestMode;
    explicitAccountId?: string;
    stopOrderId: string;
    confirm: boolean;
    tradingGate: TradingGate;
  },
): Promise<{ cancelledAt: string | null }> {
  assertMutationAllowed(params.mode, params.confirm, params.tradingGate);
  const paths = tradingPathsForMode(params.mode);
  const accountId = await resolveAccountId(api, params.explicitAccountId);
  const resp = await api.call<CancelStopOrderResponse>(paths.cancelStopOrder, {
    accountId,
    stopOrderId: params.stopOrderId,
  });
  return { cancelledAt: resp.time ?? null };
}

export function renderPlacedStopOrder(view: PlacedStopOrderView): string {
  const kindLabels: Record<StopOrderKind, string> = {
    'take-profit': 'тейк-профит',
    'stop-loss': 'стоп-лосс',
    'stop-limit': 'стоп-лимит',
  };
  return [
    `Стоп-заявка (${kindLabels[view.kind]}) по ${view.ticker} выставлена: ${view.stopOrderId ?? DASH}`,
    `${directionLabel(view.direction)} ${view.lots} лот(ов) при цене ${formatAmount(view.stopPrice)}` +
      (view.limitPrice !== null ? `, лимит ${formatAmount(view.limitPrice)}` : ''),
  ].join('\n');
}

export function renderStopOrders(views: StopOrderView[]): string {
  if (views.length === 0) {
    return 'Активных стоп-заявок нет.';
  }
  return renderTable(
    ['Номер', 'Бумага', 'Напр.', 'Лоты', 'Стоп-цена', 'Лимит', 'Создана'],
    views.map((v) => [
      v.stopOrderId ?? DASH,
      v.ticker ?? DASH,
      directionLabel(v.direction),
      v.lots !== null ? String(v.lots) : DASH,
      v.stopPrice !== null ? formatAmount(v.stopPrice) : DASH,
      v.limitPrice !== null ? formatAmount(v.limitPrice) : DASH,
      // Дата создания — в МСК (createDate приходит в UTC).
      v.createDate ? formatMoscowDate(v.createDate) : DASH,
    ]),
  );
}
