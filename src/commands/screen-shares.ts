/**
 * Команда screen shares: скринер акций по фундаментальным показателям —
 * справочник акций + батчевый GetAssetFundamentals, фильтры и сортировка.
 *
 * ВАЖНО: нулевые коэффициенты в GetAssetFundamentals означают «нет данных»
 * (протокол не различает 0 и отсутствие) — такие бумаги НЕ проходят фильтр
 * по соответствующей метрике и уходят в конец сортировки.
 *
 * Экспорты:
 * - ScreenSharesApi — контракт клиента;
 * - ScreenSharesFilter — параметры фильтра;
 * - joinAndFilterShares(...) — чистая сборка строк (тестируется без API);
 * - screenShares(api, params) — полный конвейер;
 * - renderScreenShares(view) — таблица результатов.
 */
import { formatAmount } from '../api/money.js';
import type { AssetFundamentals, GetAssetFundamentalsResponse } from '../api/types.js';
import type { ShareListItem } from '../api/types-catalog.js';
import { loadCatalog, type CatalogApi } from '../catalog/instrument-catalog.js';
import {
  BATCH_CONCURRENCY,
  BATCH_MIN_INTERVAL_MS,
  FUNDAMENTALS_CHUNK,
  SCREEN_TOP_DEFAULT,
  type TInvestMode,
} from '../config/config.js';
import { renderTable } from '../format/table.js';
import { mapWithConcurrency } from '../util/concurrency.js';

export interface ScreenSharesApi extends CatalogApi {
  getAssetFundamentals(assetUids: string[]): Promise<GetAssetFundamentalsResponse>;
}

export type ShareSortKey = 'pe' | 'roe' | 'div' | 'cap';

export interface ScreenSharesFilter {
  currency: string;
  peMax: number | null;
  pbMax: number | null;
  roeMin: number | null;
  divMin: number | null; // минимальная дивдоходность TTM, %
  sector: string | null;
  sort: ShareSortKey;
  top: number;
}

export interface ScreenShareRow {
  ticker: string;
  name: string;
  sector: string | null;
  marketCapBillions: number | null; // капитализация, млрд
  pe: number | null;
  pb: number | null;
  roe: number | null;
  divYieldTtm: number | null;
  evEbitda: number | null;
  netDebtToEbitda: number | null;
}

export interface ScreenSharesView {
  totalInCatalog: number;
  matchedUniverse: number; // рублёвые торгуемые акции с assetUid
  withFundamentals: number;
  rows: ScreenShareRow[];
  warnings: string[];
}

// Протокол не различает 0 и «нет данных» у коэффициентов — трактуем 0 как
// отсутствие значения (см. заголовок файла).
function metric(value: number | undefined): number | null {
  return value !== undefined && value !== 0 ? value : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function joinAndFilterShares(
  shares: ShareListItem[],
  fundamentalsByAssetUid: ReadonlyMap<string, AssetFundamentals>,
  filter: ScreenSharesFilter,
): ScreenShareRow[] {
  const rows: ScreenShareRow[] = [];
  for (const share of shares) {
    const fundamentals = share.assetUid ? fundamentalsByAssetUid.get(share.assetUid) : undefined;
    const pe = metric(fundamentals?.peRatioTtm);
    const pb = metric(fundamentals?.priceToBookTtm);
    const roe = metric(fundamentals?.roe);
    const divYield = metric(fundamentals?.dividendYieldDailyTtm);

    // Фильтры по метрикам требуют наличия метрики (нет данных — не проходит).
    if (filter.peMax !== null && (pe === null || pe <= 0 || pe > filter.peMax)) {
      continue;
    }
    if (filter.pbMax !== null && (pb === null || pb <= 0 || pb > filter.pbMax)) {
      continue;
    }
    if (filter.roeMin !== null && (roe === null || roe < filter.roeMin)) {
      continue;
    }
    if (filter.divMin !== null && (divYield === null || divYield < filter.divMin)) {
      continue;
    }
    if (filter.sector !== null && (share.sector ?? '').toLowerCase() !== filter.sector.toLowerCase()) {
      continue;
    }
    const cap = metric(fundamentals?.marketCapitalization);
    rows.push({
      ticker: share.ticker,
      name: share.name,
      sector: share.sector ?? null,
      marketCapBillions: cap !== null ? round2(cap / 1e9) : null,
      pe: pe !== null ? round2(pe) : null,
      pb: pb !== null ? round2(pb) : null,
      roe: roe !== null ? round2(roe) : null,
      divYieldTtm: divYield !== null ? round2(divYield) : null,
      evEbitda: metric(fundamentals?.evToEbitdaMrq) !== null ? round2(fundamentals!.evToEbitdaMrq!) : null,
      netDebtToEbitda:
        metric(fundamentals?.netDebtToEbitda) !== null ? round2(fundamentals!.netDebtToEbitda!) : null,
    });
  }

  // Сортировка: бумаги без значения метрики — в конец (независимо от порядка).
  const key = filter.sort;
  const valueOf = (row: ScreenShareRow): number | null => {
    switch (key) {
      case 'pe':
        return row.pe;
      case 'roe':
        return row.roe;
      case 'div':
        return row.divYieldTtm;
      case 'cap':
        return row.marketCapBillions;
    }
  };
  const ascending = key === 'pe'; // дешевле лучше только для P/E
  rows.sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    if (av === null && bv === null) {
      return 0;
    }
    if (av === null) {
      return 1;
    }
    if (bv === null) {
      return -1;
    }
    return ascending ? av - bv : bv - av;
  });
  return rows;
}

export async function screenShares(
  api: ScreenSharesApi,
  params: { filter: ScreenSharesFilter; mode: TInvestMode; now: Date },
): Promise<ScreenSharesView> {
  const { filter, mode, now } = params;
  const warnings: string[] = [];
  const catalog = await loadCatalog(api, 'shares', mode, now);

  // Вселенная скрининга: валюта, торгуемость через API, наличие assetUid.
  // Привилегированные акции исключаются: API считает их P/E и капитализацию
  // по капитализации ТОЛЬКО префов (проверено вживую: SBERP «P/E 0.17» при
  // честных 3.66 у эмитента) — метрики вводят в заблуждение.
  const base = catalog.items.filter(
    (s) => s.currency === filter.currency && s.apiTradeAvailableFlag !== false && s.assetUid,
  );
  const universe = base.filter((s) => s.shareType !== 'SHARE_TYPE_PREFERRED');
  const prefsExcluded = base.length - universe.length;
  if (prefsExcluded > 0) {
    warnings.push(
      `Привилегированные акции (${prefsExcluded} шт.) исключены из скрининга: ` +
        'API считает их коэффициенты по капитализации только префов, что искажает P/E и P/B.',
    );
  }

  // Фундаментал батчами по лимиту API (100 активов на запрос).
  const assetUids = [...new Set(universe.map((s) => s.assetUid!))];
  const chunks: string[][] = [];
  for (let i = 0; i < assetUids.length; i += FUNDAMENTALS_CHUNK) {
    chunks.push(assetUids.slice(i, i + FUNDAMENTALS_CHUNK));
  }
  const responses = await mapWithConcurrency(
    chunks,
    { concurrency: BATCH_CONCURRENCY, minIntervalMs: BATCH_MIN_INTERVAL_MS },
    async (chunk) => api.getAssetFundamentals(chunk),
  );
  const fundamentalsByAssetUid = new Map<string, AssetFundamentals>();
  for (const resp of responses) {
    for (const item of resp.fundamentals ?? []) {
      fundamentalsByAssetUid.set(item.assetUid, item);
    }
  }
  if (fundamentalsByAssetUid.size === 0) {
    warnings.push('API не вернул фундаментальных данных — скрининг по метрикам невозможен.');
  }

  const rows = joinAndFilterShares(universe, fundamentalsByAssetUid, filter);
  return {
    totalInCatalog: catalog.items.length,
    matchedUniverse: universe.length,
    withFundamentals: fundamentalsByAssetUid.size,
    rows: rows.slice(0, filter.top),
    warnings,
  };
}

export function defaultScreenSharesFilter(): ScreenSharesFilter {
  return {
    currency: 'rub',
    peMax: null,
    pbMax: null,
    roeMin: null,
    divMin: null,
    sector: null,
    sort: 'cap',
    top: SCREEN_TOP_DEFAULT,
  };
}

export function renderScreenShares(view: ScreenSharesView): string {
  const dash = '—';
  const lines = [
    `Каталог: ${view.totalInCatalog} акций | вселенная: ${view.matchedUniverse} | с фундаменталом: ${view.withFundamentals}`,
    '',
  ];
  if (view.rows.length === 0) {
    lines.push('Подходящих акций не найдено — ослабьте фильтры.');
  } else {
    lines.push(
      renderTable(
        ['Тикер', 'Название', 'Сектор', 'Кап., млрд', 'P/E', 'P/B', 'ROE %', 'Див. %'],
        view.rows.map((r) => [
          r.ticker,
          r.name.length > 24 ? `${r.name.slice(0, 23)}…` : r.name,
          r.sector ?? dash,
          r.marketCapBillions !== null ? formatAmount(r.marketCapBillions, 0) : dash,
          r.pe !== null ? formatAmount(r.pe, 1) : dash,
          r.pb !== null ? formatAmount(r.pb, 1) : dash,
          r.roe !== null ? formatAmount(r.roe, 1) : dash,
          r.divYieldTtm !== null ? formatAmount(r.divYieldTtm, 1) : dash,
        ]),
      ),
    );
  }
  for (const warning of view.warnings) {
    lines.push('', `⚠ ${warning}`);
  }
  return lines.join('\n');
}
