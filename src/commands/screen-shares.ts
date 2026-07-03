/**
 * Команда screen shares: скринер акций по фундаментальным показателям —
 * справочник акций + батчевый GetAssetFundamentals, фильтры и сортировка.
 *
 * ВАЖНО: нулевые коэффициенты в GetAssetFundamentals означают «нет данных»
 * (протокол не различает 0 и отсутствие) — такие бумаги НЕ проходят фильтр
 * по соответствующей метрике и уходят в конец сортировки. Единая трактовка
 * нуля вынесена в metricOrNull (src/commands/fundamentals.ts), чтобы screen
 * и fundamentals не давали противоречивых ответов по одной бумаге (K42).
 *
 * Экспорты:
 * - ScreenSharesApi — контракт клиента;
 * - ScreenSharesFilter — параметры фильтра;
 * - joinAndFilterShares(...) — чистая сборка строк (тестируется без API);
 * - screenShares(api, params) — полный конвейер;
 * - renderScreenShares(view) — таблица результатов.
 */
import { round } from '../api/money.js';
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
import { renderTable, truncate } from '../format/table.js';
import { DASH, moneyOrDash } from '../format/values.js';
import { mapWithConcurrency } from '../util/concurrency.js';
import { metricOrNull } from './fundamentals.js';

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

// Макс. ширина колонки «Название» в таблице скринера: длинные имена
// обрезаются, чтобы моноширинная таблица не расползалась в терминале.
const NAME_MAX_WIDTH = 24;

export function joinAndFilterShares(
  shares: ShareListItem[],
  fundamentalsByAssetUid: ReadonlyMap<string, AssetFundamentals>,
  filter: ScreenSharesFilter,
): ScreenShareRow[] {
  const rows: ScreenShareRow[] = [];
  for (const share of shares) {
    const fundamentals = share.assetUid ? fundamentalsByAssetUid.get(share.assetUid) : undefined;
    const pe = metricOrNull(fundamentals?.peRatioTtm);
    const pb = metricOrNull(fundamentals?.priceToBookTtm);
    const roe = metricOrNull(fundamentals?.roe);
    const divYield = metricOrNull(fundamentals?.dividendYieldDailyTtm);

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
    const cap = metricOrNull(fundamentals?.marketCapitalization);
    rows.push({
      ticker: share.ticker,
      name: share.name,
      sector: share.sector ?? null,
      marketCapBillions: cap !== null ? round(cap / 1e9) : null,
      pe: pe !== null ? round(pe) : null,
      pb: pb !== null ? round(pb) : null,
      roe: roe !== null ? round(roe) : null,
      divYieldTtm: divYield !== null ? round(divYield) : null,
      evEbitda: metricOrNull(fundamentals?.evToEbitdaMrq) !== null ? round(fundamentals!.evToEbitdaMrq!) : null,
      netDebtToEbitda:
        metricOrNull(fundamentals?.netDebtToEbitda) !== null ? round(fundamentals!.netDebtToEbitda!) : null,
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
  const lines = [
    `Каталог: ${view.totalInCatalog} акций | вселенная: ${view.matchedUniverse} | с фундаменталом: ${view.withFundamentals}`,
    '',
  ];
  if (view.rows.length === 0) {
    lines.push('Подходящих акций не найдено — ослабьте фильтры.');
  } else {
    // Ячейки — через единые хелперы «значение или прочерк» (src/format/values.ts):
    // moneyOrDash сохраняет группировку разрядов у капитализации, DASH — общий
    // символ «нет данных»; название обрезается общим truncate.
    lines.push(
      renderTable(
        ['Тикер', 'Название', 'Сектор', 'Кап., млрд', 'P/E', 'P/B', 'ROE %', 'Див. %'],
        view.rows.map((r) => [
          r.ticker,
          truncate(r.name, NAME_MAX_WIDTH),
          r.sector ?? DASH,
          moneyOrDash(r.marketCapBillions, 0),
          moneyOrDash(r.pe, 1),
          moneyOrDash(r.pb, 1),
          moneyOrDash(r.roe, 1),
          moneyOrDash(r.divYieldTtm, 1),
        ]),
      ),
    );
  }
  for (const warning of view.warnings) {
    lines.push('', `⚠ ${warning}`);
  }
  return lines.join('\n');
}
