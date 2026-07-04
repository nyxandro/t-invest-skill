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
import { moneyToNumberOrNull, numberToQuotation } from '../../api/money.js';
import { formatInstrumentPrice, priceUnitFor, priceUnitFromCurrency, type PriceUnit } from '../../format/units.js';
import { resolvePricingContext } from './pricing-context.js';
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
import { appendTradeAudit } from '../../util/audit.js';
import { mapWithConcurrency } from '../../util/concurrency.js';
import { resolveAccountId } from '../resolve-account.js';
import { resolveLabelByFigi } from '../resolve-instrument.js';
import { assertMutationAllowed, tradingPathsForMode } from './paths.js';
import { priceTypeFor } from './price-type.js';
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
  priceUnit: PriceUnit; // единица stopPrice/limitPrice: 'point' (облигации/фьючерсы) | 'currency'
  nominalRub: number | null; // номинал для ₽-эквивалента (иначе null)
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
  // priceType по типу инструмента — единый на весь запрос, покрывает и stopPrice
  // (цену активации), и price (лимит после активации). Для облигаций/фьючерсов
  // это пункты; без него цены уходят как валюта и стоп по облигации некорректен.
  const request: PostStopOrderRequest = {
    accountId,
    instrumentId: instrument.uid,
    quantity: String(params.lots),
    direction: stopDirectionToApi(params.direction),
    stopOrderType: STOP_TYPE_BY_KIND[params.kind],
    expirationType: 'STOP_ORDER_EXPIRATION_TYPE_GOOD_TILL_CANCEL',
    stopPrice: numberToQuotation(params.stopPrice),
    priceType: priceTypeFor(instrument.instrumentType),
    ...(params.limitPrice !== null ? { price: numberToQuotation(params.limitPrice) } : {}),
    orderId: clientOrderId,
  };
  // Ключ идемпотентности в stderr до отправки — для безопасного повтора (--order-id).
  console.error(
    `Ключ идемпотентности стоп-заявки: ${clientOrderId}. Для повтора: --order-id ${clientOrderId}`,
  );
  const resp = await api.call<PostStopOrderResponse>(paths.postStopOrder, request);
  // Единица цены и номинал (₽-эквивалент) по уже резолвленному инструменту.
  const pricing = await resolvePricingContext(api, instrument.instrumentType, instrument.uid);
  const view: PlacedStopOrderView = {
    stopOrderId: resp.stopOrderId ?? null,
    ticker: instrument.ticker,
    kind: params.kind,
    direction: params.direction,
    lots: params.lots,
    stopPrice: params.stopPrice,
    limitPrice: params.limitPrice,
    priceUnit: pricing.priceUnit,
    nominalRub: pricing.nominalRub,
  };
  appendTradeAudit({
    at: new Date().toISOString(),
    mode: params.mode,
    action: `stop-set:${params.kind}`,
    ticker: view.ticker,
    lots: view.lots,
    orderType: params.direction,
    price: view.stopPrice,
    orderId: view.stopOrderId,
    idempotencyKey: clientOrderId,
    status: 'выставлена',
  });
  return view;
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
  priceUnit: PriceUnit; // единица stopPrice/limitPrice: 'point' (облигации/фьючерсы) | 'currency'
  currency: string | null; // валюта поля цены из ответа API (для символа в выводе)
}

// pricing по умолчанию — валюта: инструмент не резолвлен или это акция/фонд.
// Облигации/фьючерсы помечает listStopOrders по типу, резолвленному по figi.
export function toStopOrderView(
  info: StopOrderInfo,
  pricing: { priceUnit: PriceUnit } = { priceUnit: 'currency' },
): StopOrderView {
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
    // Единицу берём из валюты самого поля stopPrice (бой — пункты, песочница —
    // рубли); тип инструмента (pricing.priceUnit) — фолбэк при отсутствии валюты.
    priceUnit: priceUnitFromCurrency(info.stopPrice?.currency) ?? pricing.priceUnit,
    currency: info.stopPrice?.currency ?? null,
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
  // По figi достаём и тикер (для читаемости), и тип инструмента → единицу цены
  // (чтобы стоп-цена облигации помечалась «пт», а не выглядела как рубли).
  const metaByFigi = new Map<string, { ticker: string; priceUnit: PriceUnit }>();
  if (uniqueFigis.length > 0) {
    await mapWithConcurrency(
      uniqueFigis,
      { concurrency: BATCH_CONCURRENCY, minIntervalMs: BATCH_MIN_INTERVAL_MS },
      async (figi): Promise<null> => {
        try {
          const label = await resolveLabelByFigi(api, figi);
          if (label) {
            metaByFigi.set(figi, { ticker: label.ticker, priceUnit: priceUnitFor(label.instrumentType) });
          }
        } catch (err) {
          console.error(
            `Предупреждение: не удалось получить тикер/единицу цены по FIGI ${figi}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        return null;
      },
    );
  }
  return infos.map((info) => {
    const meta = info.figi ? metaByFigi.get(info.figi) : undefined;
    const view = toStopOrderView(info, { priceUnit: meta?.priceUnit ?? 'currency' });
    return meta ? { ...view, ticker: meta.ticker } : view;
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
  appendTradeAudit({
    at: new Date().toISOString(),
    mode: params.mode,
    action: 'stop-cancel',
    ticker: null,
    orderId: params.stopOrderId,
    status: resp.time ? 'отменена' : 'отмена отправлена',
  });
  return { cancelledAt: resp.time ?? null };
}

export function renderPlacedStopOrder(view: PlacedStopOrderView): string {
  const kindLabels: Record<StopOrderKind, string> = {
    'take-profit': 'тейк-профит',
    'stop-loss': 'стоп-лосс',
    'stop-limit': 'стоп-лимит',
  };
  // Детальный вывод: стоп-цена и лимит с меткой единицы и ₽-эквивалентом (B).
  const priceOpts = { unit: view.priceUnit, nominalRub: view.nominalRub, currency: null };
  return [
    `Стоп-заявка (${kindLabels[view.kind]}) по ${view.ticker} выставлена: ${view.stopOrderId ?? DASH}`,
    `${directionLabel(view.direction)} ${view.lots} лот(ов) при цене ${formatInstrumentPrice(view.stopPrice, priceOpts)}` +
      (view.limitPrice !== null ? `, лимит ${formatInstrumentPrice(view.limitPrice, priceOpts)}` : ''),
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
      // В таблице — метка единицы без ₽-эквивалента (nominalRub не тянем на список):
      // «пт» в бою, символ валюты — в песочнице (где цена приходит в рублях).
      v.stopPrice !== null
        ? formatInstrumentPrice(v.stopPrice, { unit: v.priceUnit, nominalRub: null, currency: v.currency })
        : DASH,
      v.limitPrice !== null
        ? formatInstrumentPrice(v.limitPrice, { unit: v.priceUnit, nominalRub: null, currency: v.currency })
        : DASH,
      // Дата создания — в МСК (createDate приходит в UTC).
      v.createDate ? formatMoscowDate(v.createDate) : DASH,
    ]),
  );
}
