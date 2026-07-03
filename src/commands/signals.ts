/**
 * Команда signals: инвестиционные сигналы аналитических стратегий
 * (SignalService) — направление, целевая цена, вероятность; имена бумаг
 * резолвятся через кэшируемые справочники.
 *
 * Экспорты:
 * - SignalsApi — контракт клиента;
 * - SignalView, StrategyView — представления;
 * - buildSignalViews(signals, instrumentsByUid) — чистая сборка;
 * - fetchSignals(api, params) — сигналы (+ фильтры по стратегии/бумаге);
 * - fetchStrategies(api) — список стратегий;
 * - renderSignals(views) / renderStrategies(views) — вывод.
 */
import { formatAmount, quotationToNumberOrNull, round } from '../api/money.js';
import type { GetSignalsResponse, GetStrategiesResponse, Signal } from '../api/types-info.js';
import { loadCatalog, type CatalogApi } from '../catalog/instrument-catalog.js';
import { SIGNALS_DEFAULT_LIMIT, type TInvestMode } from '../config/config.js';
import { directionLabel } from '../format/direction.js';
import { renderTable } from '../format/table.js';
import { DASH, moneyOrDash } from '../format/values.js';
import { resolveInstrument, type InstrumentSearchApi } from './resolve-instrument.js';

export interface SignalsApi extends InstrumentSearchApi, CatalogApi {
  getStrategies(): Promise<GetStrategiesResponse>;
  getSignals(params: {
    strategyId?: string;
    instrumentUid?: string;
    active: 'SIGNAL_STATE_ACTIVE' | 'SIGNAL_STATE_ALL';
    limit: number;
  }): Promise<GetSignalsResponse>;
}

export interface SignalView {
  signalId: string;
  strategyName: string | null;
  ticker: string | null; // из справочника; null — бумага вне каталогов
  instrumentName: string | null;
  instrumentUid: string | null;
  direction: 'buy' | 'sell' | null;
  ideaName: string | null;
  createdAt: string | null;
  endsAt: string | null;
  initialPrice: number | null;
  targetPrice: number | null;
  potentialPercent: number | null; // цель к начальной цене сигнала
  probability: number | null;
}

export interface StrategyView {
  strategyId: string;
  name: string | null;
  type: 'technical' | 'fundamental' | null;
  description: string | null;
  activeSignals: number | null;
  totalSignals: number | null;
}

export function buildSignalViews(
  signals: Signal[],
  instrumentsByUid: ReadonlyMap<string, { ticker: string; name: string }>,
): SignalView[] {
  return signals.map((signal): SignalView => {
    const instrument = signal.instrumentUid ? instrumentsByUid.get(signal.instrumentUid) : undefined;
    // Опущенные protobuf-JSON message-поля цен → null.
    const initialPrice = quotationToNumberOrNull(signal.initialPrice);
    const targetPrice = quotationToNumberOrNull(signal.targetPrice);
    return {
      signalId: signal.signalId,
      strategyName: signal.strategyName ?? null,
      ticker: instrument?.ticker ?? null,
      instrumentName: instrument?.name ?? null,
      instrumentUid: signal.instrumentUid ?? null,
      // Направление сигнала — собственный enum SIGNAL_DIRECTION_* (не order/stop),
      // поэтому маппинг локальный; на неизвестное значение честно null.
      direction:
        signal.direction === 'SIGNAL_DIRECTION_BUY'
          ? 'buy'
          : signal.direction === 'SIGNAL_DIRECTION_SELL'
            ? 'sell'
            : null,
      ideaName: signal.name ?? null,
      createdAt: signal.createDt?.slice(0, 10) ?? null,
      endsAt: signal.endDt?.slice(0, 10) ?? null,
      initialPrice,
      targetPrice,
      potentialPercent:
        initialPrice !== null && initialPrice !== 0 && targetPrice !== null
          ? round((targetPrice / initialPrice - 1) * 100)
          : null,
      probability: signal.probability ?? null,
    };
  });
}

export async function fetchSignals(
  api: SignalsApi,
  params: {
    mode: TInvestMode;
    now: Date;
    strategyId?: string;
    ticker?: string;
    limit?: number;
    cacheDir?: string;
  },
): Promise<SignalView[]> {
  // Фильтр по бумаге — через точный резолв тикера.
  const instrumentUid = params.ticker
    ? (await resolveInstrument(api, params.ticker)).uid
    : undefined;
  const resp = await api.getSignals({
    strategyId: params.strategyId,
    instrumentUid,
    active: 'SIGNAL_STATE_ACTIVE',
    limit: params.limit ?? SIGNALS_DEFAULT_LIMIT,
  });
  const signals = resp.signals ?? [];
  // Нет сигналов — справочники (мегабайты данных) не нужны: ранний выход,
  // ни одной загрузки каталога.
  if (signals.length === 0) {
    return [];
  }

  // Имена бумаг — из кэшируемых справочников (без запроса на каждый сигнал).
  // Сигнал не несёт вид инструмента, поэтому нужны все три справочника; грузим
  // их параллельно (независимые запросы), а не последовательно в цикле.
  const catalogs = await Promise.all(
    (['shares', 'bonds', 'etfs'] as const).map((kind) =>
      loadCatalog(api, kind, params.mode, params.now, params.cacheDir),
    ),
  );
  const instrumentsByUid = new Map<string, { ticker: string; name: string }>();
  for (const catalog of catalogs) {
    for (const item of catalog.items) {
      instrumentsByUid.set(item.uid, { ticker: item.ticker, name: item.name });
    }
  }
  return buildSignalViews(signals, instrumentsByUid);
}

export async function fetchStrategies(api: SignalsApi): Promise<StrategyView[]> {
  const resp = await api.getStrategies();
  return (resp.strategies ?? []).map((s) => ({
    strategyId: s.strategyId,
    name: s.strategyName ?? null,
    type:
      s.strategyType === 'STRATEGY_TYPE_TECHNICAL'
        ? 'technical'
        : s.strategyType === 'STRATEGY_TYPE_FUNDAMENTAL'
          ? 'fundamental'
          : null,
    description: s.strategyDescription ?? null,
    activeSignals: s.activeSignals ?? null,
    totalSignals: s.totalSignals ?? null,
  }));
}

export function renderSignals(views: SignalView[]): string {
  if (views.length === 0) {
    return 'Активных сигналов по заданным фильтрам нет.';
  }
  return renderTable(
    ['Бумага', 'Напр.', 'Стратегия', 'Цель', 'Потенциал', 'Вероятн.', 'До'],
    views.map((v) => [
      v.ticker ?? v.instrumentUid?.slice(0, 8) ?? DASH,
      directionLabel(v.direction),
      v.strategyName ?? DASH,
      moneyOrDash(v.targetPrice),
      // Потенциал — с суффиксом « %» через пробел, поэтому не percentOrDash.
      v.potentialPercent !== null ? `${formatAmount(v.potentialPercent, 1)} %` : DASH,
      v.probability !== null ? `${v.probability} %` : DASH,
      v.endsAt ?? DASH,
    ]),
  );
}

export function renderStrategies(views: StrategyView[]): string {
  if (views.length === 0) {
    return 'Стратегии недоступны.';
  }
  const lines: string[] = [];
  for (const s of views) {
    lines.push(
      `• ${s.name ?? s.strategyId} [${s.type ?? DASH}] — активных сигналов: ${s.activeSignals ?? 0}`,
    );
  }
  return lines.join('\n');
}
